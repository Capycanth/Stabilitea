import type { PrismaClient } from '../src/generated/prisma/client.js';

interface StarterCategory {
  name: string;
  kind: 'income' | 'expense';
  rollover: boolean;
  subcategories: [name: string, defaultLimitCents: number][];
}

export const STARTER_CATEGORIES: StarterCategory[] = [
  { name: 'Income', kind: 'income', rollover: false, subcategories: [['Salary', 0], ['Other Income', 0]] },
  {
    name: 'Housing',
    kind: 'expense',
    rollover: false,
    subcategories: [['Rent/Mortgage', 150_000], ['Utilities', 15_000], ['Internet', 7_000]],
  },
  { name: 'Food', kind: 'expense', rollover: true, subcategories: [['Groceries', 50_000], ['Dining Out', 20_000]] },
  { name: 'Transportation', kind: 'expense', rollover: true, subcategories: [['Fuel', 15_000], ['Maintenance', 7_500]] },
  {
    name: 'Personal',
    kind: 'expense',
    rollover: false,
    subcategories: [['Clothing', 10_000], ['Entertainment', 10_000], ['Subscriptions', 5_000]],
  },
];

/** Inserts the starter categories when the database has none. Returns true if it inserted. */
export async function seedStarterCategories(prisma: Pick<PrismaClient, 'category'>): Promise<boolean> {
  if ((await prisma.category.count()) > 0) return false;
  for (const [index, category] of STARTER_CATEGORIES.entries()) {
    await prisma.category.create({
      data: {
        name: category.name,
        kind: category.kind,
        rollover: category.rollover,
        sortOrder: index,
        subcategories: {
          create: category.subcategories.map(([name, defaultLimitCents], subIndex) => ({
            name,
            defaultLimitCents,
            sortOrder: subIndex,
          })),
        },
      },
    });
  }
  return true;
}
