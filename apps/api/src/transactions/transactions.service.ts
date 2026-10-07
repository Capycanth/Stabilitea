import { Injectable } from '@nestjs/common';
import { isValidMonth, monthBounds, monthOf, type TransactionDto, type TransactionType } from '@stabilitea/shared';
import { BudgetLifecycleService } from '../budgets/budget-lifecycle.service.js';
import { fieldError, notFound, validationError } from '../common/errors.js';
import type { Group, Category, Transaction } from '../generated/prisma/client.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';
import type { CreateTransactionDto, TransactionQueryDto, UpdateTransactionDto } from './transactions.dto.js';

type TransactionRow = Transaction & { category: Category & { group: Group } };

function toDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    date: row.date,
    type: row.type as TransactionType,
    amountCents: row.amountCents,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    groupId: row.category.groupId,
    groupName: row.category.group.name,
    payee: row.payee,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = { category: { include: { group: true } } } as const;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BudgetLifecycleService,
  ) {}

  async list(query: TransactionQueryDto): Promise<TransactionDto[]> {
    if (!isValidMonth(query.month)) throw fieldError('month', 'Month must be in YYYY-MM format');
    const { first, last } = monthBounds(query.month);
    const rows = await this.prisma.transaction.findMany({
      where: {
        date: { gte: first, lte: last },
        type: query.type,
        categoryId: query.categoryId,
        category: query.groupId ? { groupId: query.groupId } : undefined,
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include,
    });
    return rows.map(toDto);
  }

  async create(dto: CreateTransactionDto): Promise<TransactionDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertOpen(tx, monthOf(dto.date));
      await this.assertCategoryMatches(tx, dto.categoryId, dto.type, { allowArchived: false });
      const row = await tx.transaction.create({
        data: {
          date: dto.date,
          type: dto.type,
          amountCents: dto.amountCents,
          categoryId: dto.categoryId,
          payee: dto.payee ?? null,
          note: dto.note ?? null,
        },
        include,
      });
      // A payment on a recurring bill starts its next cycle, which reshapes later months' shares.
      await this.lifecycle.syncRecurringLines(tx, dto.categoryId);
      return toDto(row);
    });
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<TransactionDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.transaction.findUnique({ where: { id } });
      if (!current) throw notFound(`Transaction ${id} not found`);

      const date = dto.date ?? current.date;
      await this.lifecycle.assertOpen(tx, monthOf(current.date));
      if (monthOf(date) !== monthOf(current.date)) await this.lifecycle.assertOpen(tx, monthOf(date));

      const categoryId = dto.categoryId ?? current.categoryId;
      const type = dto.type ?? (current.type as TransactionType);
      await this.assertCategoryMatches(tx, categoryId, type, {
        allowArchived: categoryId === current.categoryId,
      });

      const row = await tx.transaction.update({
        where: { id },
        data: {
          date,
          type,
          categoryId,
          amountCents: dto.amountCents,
          payee: dto.payee === undefined ? undefined : dto.payee,
          note: dto.note === undefined ? undefined : dto.note,
        },
        include,
      });
      await this.lifecycle.syncRecurringLines(tx, categoryId);
      if (categoryId !== current.categoryId) await this.lifecycle.syncRecurringLines(tx, current.categoryId);
      return toDto(row);
    });
  }

  async remove(id: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.transaction.findUnique({ where: { id } });
      if (!current) throw notFound(`Transaction ${id} not found`);
      await this.lifecycle.assertOpen(tx, monthOf(current.date));
      await tx.transaction.delete({ where: { id } });
      await this.lifecycle.syncRecurringLines(tx, current.categoryId);
    });
  }

  private async assertCategoryMatches(
    db: Db,
    categoryId: number,
    type: TransactionType,
    { allowArchived }: { allowArchived: boolean },
  ): Promise<void> {
    const category = await db.category.findUnique({ where: { id: categoryId }, include: { group: true } });
    if (!category) throw fieldError('categoryId', 'Category not found');
    if (!allowArchived && (category.archivedAt || category.group.archivedAt)) {
      throw fieldError('categoryId', `${category.name} is archived`);
    }
    if (category.group.kind !== type) {
      throw validationError(
        { type: [`${category.group.name} is an ${category.group.kind} group, so the type must be ${category.group.kind}`] },
        'Type does not match group',
      );
    }
  }
}
