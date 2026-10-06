import { Injectable } from '@nestjs/common';
import type { CategoryDto, CategoryKind, SubcategoryDto } from '@stabilitea/shared';
import { BudgetLifecycleService } from '../budgets/budget-lifecycle.service.js';
import { fieldError, notFound } from '../common/errors.js';
import type { Category, Subcategory } from '../generated/prisma/client.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';
import type { CreateCategoryDto, CreateSubcategoryDto, UpdateCategoryDto, UpdateSubcategoryDto } from './categories.dto.js';

/** Returns ids in their new order after moving `id` to `targetIndex`. */
export function moveItem(ids: number[], id: number, targetIndex: number): number[] {
  const rest = ids.filter((x) => x !== id);
  const index = Math.max(0, Math.min(targetIndex, rest.length));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

function toSubcategoryDto(sub: Subcategory & { _count?: { transactions: number } }): SubcategoryDto {
  return {
    id: sub.id,
    categoryId: sub.categoryId,
    name: sub.name,
    defaultLimitCents: sub.defaultLimitCents,
    sortOrder: sub.sortOrder,
    archivedAt: sub.archivedAt?.toISOString() ?? null,
    transactionCount: sub._count?.transactions ?? 0,
  };
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BudgetLifecycleService,
  ) {}

  async list(includeArchived = false): Promise<CategoryDto[]> {
    const where = includeArchived ? {} : { archivedAt: null };
    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        subcategories: {
          where,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { _count: { select: { transactions: true } } },
        },
      },
    });
    return rows.map((row) => this.toDto(row, row.subcategories));
  }

  async create(dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCategoryNameFree(tx, dto.name);
      const count = await tx.category.count();
      const row = await tx.category.create({
        data: { name: dto.name, kind: dto.kind, rollover: dto.kind === 'expense' && (dto.rollover ?? false), sortOrder: count },
      });
      return this.toDto(row, []);
    });
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<CategoryDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id } });
      if (!current) throw notFound(`Category ${id} not found`);

      if (dto.name !== undefined && dto.name !== current.name) {
        await this.assertCategoryNameFree(tx, dto.name, id);
      }
      if (dto.rollover !== undefined && current.kind !== 'expense' && dto.rollover) {
        throw fieldError('rollover', 'Only expense categories can roll over');
      }

      await tx.category.update({
        where: { id },
        data: {
          name: dto.name,
          rollover: dto.rollover,
          archivedAt: dto.archived === undefined ? undefined : dto.archived ? (current.archivedAt ?? new Date()) : null,
        },
      });

      if (dto.rollover !== undefined && dto.rollover !== current.rollover) {
        await this.lifecycle.applyRolloverToOpenMonths(tx, id, dto.rollover);
      }

      if (dto.archived === false && current.archivedAt) {
        const subs = await tx.subcategory.findMany({ where: { categoryId: id, archivedAt: null } });
        for (const sub of subs) await this.lifecycle.addLineToOpenMonths(tx, sub.id);
      }

      if (dto.sortOrder !== undefined) {
        const siblings = await tx.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } });
        const order = moveItem(siblings.map((s) => s.id), id, dto.sortOrder);
        for (const [index, siblingId] of order.entries()) {
          await tx.category.update({ where: { id: siblingId }, data: { sortOrder: index } });
        }
      }
    });
    return this.getOne(id);
  }

  async createSubcategory(categoryId: number, dto: CreateSubcategoryDto): Promise<SubcategoryDto> {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category) throw notFound(`Category ${categoryId} not found`);
      await this.assertSubcategoryNameFree(tx, categoryId, dto.name);
      const count = await tx.subcategory.count({ where: { categoryId } });
      const sub = await tx.subcategory.create({
        data: { categoryId, name: dto.name, defaultLimitCents: dto.defaultLimitCents ?? 0, sortOrder: count },
      });
      await this.lifecycle.addLineToOpenMonths(tx, sub.id);
      return toSubcategoryDto(sub);
    });
  }

  async updateSubcategory(id: number, dto: UpdateSubcategoryDto): Promise<SubcategoryDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.subcategory.findUnique({ where: { id }, include: { category: true } });
      if (!current) throw notFound(`Subcategory ${id} not found`);

      let categoryId = current.categoryId;
      let target: Category = current.category;
      if (dto.categoryId !== undefined && dto.categoryId !== current.categoryId) {
        const found = await tx.category.findUnique({ where: { id: dto.categoryId } });
        if (!found) throw fieldError('categoryId', 'Category not found');
        if (found.kind !== current.category.kind) {
          throw fieldError('categoryId', `Move to another ${current.category.kind} category`);
        }
        categoryId = found.id;
        target = found;
      }

      const name = dto.name ?? current.name;
      if (name !== current.name || categoryId !== current.categoryId) {
        await this.assertSubcategoryNameFree(tx, categoryId, name, id);
      }

      await tx.subcategory.update({
        where: { id },
        data: {
          name,
          categoryId,
          defaultLimitCents: dto.defaultLimitCents,
          sortOrder: categoryId !== current.categoryId ? await tx.subcategory.count({ where: { categoryId } }) : undefined,
          archivedAt: dto.archived === undefined ? undefined : dto.archived ? (current.archivedAt ?? new Date()) : null,
        },
      });

      if (categoryId !== current.categoryId) {
        await tx.budgetLine.updateMany({
          where: { subcategoryId: id, budgetMonth: { status: 'open' } },
          data: { rollover: target.rollover },
        });
      }

      if (dto.archived === false && current.archivedAt) {
        await this.lifecycle.addLineToOpenMonths(tx, id);
      }

      if (dto.sortOrder !== undefined) {
        const siblings = await tx.subcategory.findMany({
          where: { categoryId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        const order = moveItem(siblings.map((s) => s.id), id, dto.sortOrder);
        for (const [index, siblingId] of order.entries()) {
          await tx.subcategory.update({ where: { id: siblingId }, data: { sortOrder: index } });
        }
      }

      const updated = await tx.subcategory.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { transactions: true } } },
      });
      return toSubcategoryDto(updated);
    });
  }

  private async getOne(id: number): Promise<CategoryDto> {
    const row = await this.prisma.category.findUniqueOrThrow({
      where: { id },
      include: {
        subcategories: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { _count: { select: { transactions: true } } },
        },
      },
    });
    return this.toDto(row, row.subcategories);
  }

  private toDto(row: Category, subs: (Subcategory & { _count?: { transactions: number } })[]): CategoryDto {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as CategoryKind,
      rollover: row.rollover,
      sortOrder: row.sortOrder,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      subcategories: subs.map(toSubcategoryDto),
    };
  }

  private async assertCategoryNameFree(db: Db, name: string, exceptId?: number): Promise<void> {
    const clash = await db.category.findFirst({ where: { name, archivedAt: null, NOT: exceptId ? { id: exceptId } : undefined } });
    if (clash) throw fieldError('name', `A category named "${name}" already exists`);
  }

  private async assertSubcategoryNameFree(db: Db, categoryId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await db.subcategory.findFirst({ where: { categoryId, name, NOT: exceptId ? { id: exceptId } : undefined } });
    if (clash) throw fieldError('name', `"${name}" already exists in this category`);
  }
}
