import { Injectable } from '@nestjs/common';
import { isValidMonth, monthBounds, monthOf, type TransactionDto, type TransactionType } from '@stabilitea/shared';
import { BudgetLifecycleService } from '../budgets/budget-lifecycle.service.js';
import { fieldError, notFound, validationError } from '../common/errors.js';
import type { Category, Subcategory, Transaction } from '../generated/prisma/client.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';
import type { CreateTransactionDto, TransactionQueryDto, UpdateTransactionDto } from './transactions.dto.js';

type TransactionRow = Transaction & { subcategory: Subcategory & { category: Category } };

function toDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    date: row.date,
    type: row.type as TransactionType,
    amountCents: row.amountCents,
    subcategoryId: row.subcategoryId,
    subcategoryName: row.subcategory.name,
    categoryId: row.subcategory.categoryId,
    categoryName: row.subcategory.category.name,
    payee: row.payee,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = { subcategory: { include: { category: true } } } as const;

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
        subcategoryId: query.subcategoryId,
        subcategory: query.categoryId ? { categoryId: query.categoryId } : undefined,
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include,
    });
    return rows.map(toDto);
  }

  async create(dto: CreateTransactionDto): Promise<TransactionDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertOpen(tx, monthOf(dto.date));
      await this.assertSubcategoryMatches(tx, dto.subcategoryId, dto.type, { allowArchived: false });
      const row = await tx.transaction.create({
        data: {
          date: dto.date,
          type: dto.type,
          amountCents: dto.amountCents,
          subcategoryId: dto.subcategoryId,
          payee: dto.payee ?? null,
          note: dto.note ?? null,
        },
        include,
      });
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

      const subcategoryId = dto.subcategoryId ?? current.subcategoryId;
      const type = dto.type ?? (current.type as TransactionType);
      await this.assertSubcategoryMatches(tx, subcategoryId, type, {
        allowArchived: subcategoryId === current.subcategoryId,
      });

      const row = await tx.transaction.update({
        where: { id },
        data: {
          date,
          type,
          subcategoryId,
          amountCents: dto.amountCents,
          payee: dto.payee === undefined ? undefined : dto.payee,
          note: dto.note === undefined ? undefined : dto.note,
        },
        include,
      });
      return toDto(row);
    });
  }

  async remove(id: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.transaction.findUnique({ where: { id } });
      if (!current) throw notFound(`Transaction ${id} not found`);
      await this.lifecycle.assertOpen(tx, monthOf(current.date));
      await tx.transaction.delete({ where: { id } });
    });
  }

  private async assertSubcategoryMatches(
    db: Db,
    subcategoryId: number,
    type: TransactionType,
    { allowArchived }: { allowArchived: boolean },
  ): Promise<void> {
    const sub = await db.subcategory.findUnique({ where: { id: subcategoryId }, include: { category: true } });
    if (!sub) throw fieldError('subcategoryId', 'Subcategory not found');
    if (!allowArchived && (sub.archivedAt || sub.category.archivedAt)) {
      throw fieldError('subcategoryId', `${sub.name} is archived`);
    }
    if (sub.category.kind !== type) {
      throw validationError(
        { type: [`${sub.category.name} is an ${sub.category.kind} category, so the type must be ${sub.category.kind}`] },
        'Type does not match category',
      );
    }
  }
}
