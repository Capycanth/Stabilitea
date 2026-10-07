import type { PrismaClient } from '../src/generated/prisma/client.js';

/** [name, defaultLimitCents, fund?] */
type StarterSubcategory = [name: string, defaultLimitCents: number, fund?: boolean];

interface StarterCategory {
  name: string;
  kind: 'income' | 'expense';
  subcategories: StarterSubcategory[];
}

export const STARTER_CATEGORIES: StarterCategory[] = [
  { name: 'Income', kind: 'income', subcategories: [['Salary', 0], ['Other Income', 0]] },
  { name: 'Housing', kind: 'expense', subcategories: [['Rent/Mortgage', 150_000], ['Utilities', 15_000], ['Internet', 7_000]] },
  { name: 'Food', kind: 'expense', subcategories: [['Groceries', 50_000], ['Dining Out', 20_000]] },
  // Car maintenance is lumpy: a fund lets it build up in quiet months and absorb the big bills.
  { name: 'Transportation', kind: 'expense', subcategories: [['Fuel', 15_000], ['Maintenance', 7_500, true]] },
  {
    name: 'Personal',
    kind: 'expense',
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
        sortOrder: index,
        subcategories: {
          create: category.subcategories.map(([name, defaultLimitCents, fund], subIndex) => ({
            name,
            defaultLimitCents,
            fund: fund ?? false,
            sortOrder: subIndex,
          })),
        },
      },
    });
  }
  return true;
}
