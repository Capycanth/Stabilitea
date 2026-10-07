import { Injectable } from '@nestjs/common';
import type { CategoryDto, CategoryType, GroupDto, GroupKind, RecurringBillFields } from '@stabilitea/shared';
import { BudgetLifecycleService } from '../budgets/budget-lifecycle.service.js';
import { fieldError, notFound, validationError } from '../common/errors.js';
import type { Group, Category } from '../generated/prisma/client.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';
import type { CreateGroupDto, CreateCategoryDto, UpdateGroupDto, UpdateCategoryDto } from './groups.dto.js';

/** Returns ids in their new order after moving `id` to `targetIndex`. */
export function moveItem(ids: number[], id: number, targetIndex: number): number[] {
  const rest = ids.filter((x) => x !== id);
  const index = Math.max(0, Math.min(targetIndex, rest.length));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

function toCategoryDto(category: Category & { _count?: { transactions: number } }): CategoryDto {
  return {
    id: category.id,
    groupId: category.groupId,
    name: category.name,
    defaultLimitCents: category.defaultLimitCents,
    type: category.type as CategoryType,
    billCents: category.billCents,
    billMonths: category.billMonths,
    nextDueMonth: category.nextDueMonth,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt?.toISOString() ?? null,
    transactionCount: category._count?.transactions ?? 0,
  };
}

interface TypeSettings {
  type: CategoryType;
  billCents: number | null;
  billMonths: number | null;
  nextDueMonth: string | null;
}

/**
 * The type and bill settings a category will have after a create or update, merged with its current settings.
 * Fund and recurring are expense only; recurring needs all three bill fields.
 */
export function resolveTypeSettings(
  kind: string,
  current: TypeSettings | null,
  dto: RecurringBillFields & { type?: CategoryType },
): TypeSettings {
  const settings: TypeSettings = {
    type: dto.type ?? current?.type ?? 'standard',
    billCents: dto.billCents ?? current?.billCents ?? null,
    billMonths: dto.billMonths ?? current?.billMonths ?? null,
    nextDueMonth: dto.nextDueMonth ?? current?.nextDueMonth ?? null,
  };
  if (settings.type !== 'standard' && kind !== 'expense') {
    throw fieldError('type', 'Only expense categories can be funds or recurring');
  }
  if (settings.type === 'recurring') {
    const errors: Record<string, string[]> = {};
    if (settings.billCents === null) errors['billCents'] = ['Bill amount is required for a recurring category'];
    if (settings.billMonths === null) errors['billMonths'] = ['Months are required for a recurring category'];
    if (settings.nextDueMonth === null) errors['nextDueMonth'] = ['Next due month is required for a recurring category'];
    if (Object.keys(errors).length) throw validationError(errors, 'Recurring categories need a bill amount, months and a due month');
  }
  return settings;
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BudgetLifecycleService,
  ) {}

  async list(includeArchived = false): Promise<GroupDto[]> {
    const where = includeArchived ? {} : { archivedAt: null };
    const rows = await this.prisma.group.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        categories: {
          where,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { _count: { select: { transactions: true } } },
        },
      },
    });
    return rows.map((row) => this.toDto(row, row.categories));
  }

  async create(dto: CreateGroupDto): Promise<GroupDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGroupNameFree(tx, dto.name);
      const count = await tx.group.count();
      const row = await tx.group.create({
        data: { name: dto.name, kind: dto.kind, sortOrder: count },
      });
      return this.toDto(row, []);
    });
  }

  async update(id: number, dto: UpdateGroupDto): Promise<GroupDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.group.findUnique({ where: { id } });
      if (!current) throw notFound(`Group ${id} not found`);

      if (dto.name !== undefined && dto.name !== current.name) {
        await this.assertGroupNameFree(tx, dto.name, id);
      }
      await tx.group.update({
        where: { id },
        data: {
          name: dto.name,
          archivedAt: dto.archived === undefined ? undefined : dto.archived ? (current.archivedAt ?? new Date()) : null,
        },
      });

      if (dto.archived === false && current.archivedAt) {
        const categories = await tx.category.findMany({ where: { groupId: id, archivedAt: null } });
        for (const category of categories) await this.lifecycle.addLineToOpenMonths(tx, category.id);
      }

      if (dto.sortOrder !== undefined) {
        const siblings = await tx.group.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } });
        const order = moveItem(siblings.map((s) => s.id), id, dto.sortOrder);
        for (const [index, siblingId] of order.entries()) {
          await tx.group.update({ where: { id: siblingId }, data: { sortOrder: index } });
        }
      }
    });
    return this.getOne(id);
  }

  async createCategory(groupId: number, dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      if (!group) throw notFound(`Group ${groupId} not found`);
      await this.assertCategoryNameFree(tx, groupId, dto.name);
      const settings = resolveTypeSettings(group.kind, null, dto);
      const count = await tx.category.count({ where: { groupId } });
      const category = await tx.category.create({
        data: {
          groupId,
          name: dto.name,
          defaultLimitCents: dto.defaultLimitCents ?? 0,
          ...settings,
          sortOrder: count,
        },
      });
      await this.lifecycle.addLineToOpenMonths(tx, category.id);
      return toCategoryDto(category);
    });
  }

  async updateCategory(id: number, dto: UpdateCategoryDto): Promise<CategoryDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id }, include: { group: true } });
      if (!current) throw notFound(`Category ${id} not found`);

      let groupId = current.groupId;
      if (dto.groupId !== undefined && dto.groupId !== current.groupId) {
        const found = await tx.group.findUnique({ where: { id: dto.groupId } });
        if (!found) throw fieldError('groupId', 'Group not found');
        if (found.kind !== current.group.kind) {
          throw fieldError('groupId', `Move to another ${current.group.kind} group`);
        }
        groupId = found.id;
      }
      const settings = resolveTypeSettings(current.group.kind, current as TypeSettings, dto);

      const name = dto.name ?? current.name;
      if (name !== current.name || groupId !== current.groupId) {
        await this.assertCategoryNameFree(tx, groupId, name, id);
      }

      await tx.category.update({
        where: { id },
        data: {
          name,
          groupId,
          defaultLimitCents: dto.defaultLimitCents,
          ...settings,
          sortOrder: groupId !== current.groupId ? await tx.category.count({ where: { groupId } }) : undefined,
          archivedAt: dto.archived === undefined ? undefined : dto.archived ? (current.archivedAt ?? new Date()) : null,
        },
      });

      if (settings.type !== current.type) {
        await this.lifecycle.applyTypeToOpenMonths(tx, id, settings.type, dto.defaultLimitCents ?? current.defaultLimitCents);
      } else if (settings.type === 'recurring') {
        // Bill changes reshape the shares still to be stored.
        await this.lifecycle.syncRecurringLines(tx, id);
      }

      if (dto.archived === false && current.archivedAt) {
        await this.lifecycle.addLineToOpenMonths(tx, id);
      }

      if (dto.sortOrder !== undefined) {
        const siblings = await tx.category.findMany({
          where: { groupId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        const order = moveItem(siblings.map((s) => s.id), id, dto.sortOrder);
        for (const [index, siblingId] of order.entries()) {
          await tx.category.update({ where: { id: siblingId }, data: { sortOrder: index } });
        }
      }

      const updated = await tx.category.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { transactions: true } } },
      });
      return toCategoryDto(updated);
    });
  }

  private async getOne(id: number): Promise<GroupDto> {
    const row = await this.prisma.group.findUniqueOrThrow({
      where: { id },
      include: {
        categories: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { _count: { select: { transactions: true } } },
        },
      },
    });
    return this.toDto(row, row.categories);
  }

  private toDto(row: Group, categories: (Category & { _count?: { transactions: number } })[]): GroupDto {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as GroupKind,
      sortOrder: row.sortOrder,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      categories: categories.map(toCategoryDto),
    };
  }

  private async assertGroupNameFree(db: Db, name: string, exceptId?: number): Promise<void> {
    const clash = await db.group.findFirst({ where: { name, archivedAt: null, NOT: exceptId ? { id: exceptId } : undefined } });
    if (clash) throw fieldError('name', `A group named "${name}" already exists`);
  }

  private async assertCategoryNameFree(db: Db, groupId: number, name: string, exceptId?: number): Promise<void> {
    const clash = await db.category.findFirst({ where: { groupId, name, NOT: exceptId ? { id: exceptId } : undefined } });
    if (clash) throw fieldError('name', `"${name}" already exists in this group`);
  }
}
