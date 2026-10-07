import type { PrismaClient } from '../src/generated/prisma/client.js';

/** [name, defaultLimitCents, fund?] */
type StarterCategory = [name: string, defaultLimitCents: number, fund?: boolean];

interface StarterGroup {
  name: string;
  kind: 'income' | 'expense';
  categories: StarterCategory[];
}

export const STARTER_GROUPS: StarterGroup[] = [
  { name: 'Income', kind: 'income', categories: [['Salary', 0], ['Other Income', 0]] },
  { name: 'Housing', kind: 'expense', categories: [['Rent/Mortgage', 150_000], ['Utilities', 15_000], ['Internet', 7_000]] },
  { name: 'Food', kind: 'expense', categories: [['Groceries', 50_000], ['Dining Out', 20_000]] },
  // Car maintenance is lumpy: a fund lets it build up in quiet months and absorb the big bills.
  { name: 'Transportation', kind: 'expense', categories: [['Fuel', 15_000], ['Maintenance', 7_500, true]] },
  {
    name: 'Personal',
    kind: 'expense',
    categories: [['Clothing', 10_000], ['Entertainment', 10_000], ['Subscriptions', 5_000]],
  },
];

/** Inserts the starter groups when the database has none. Returns true if it inserted. */
export async function seedStarterGroups(prisma: Pick<PrismaClient, 'group'>): Promise<boolean> {
  if ((await prisma.group.count()) > 0) return false;
  for (const [index, group] of STARTER_GROUPS.entries()) {
    await prisma.group.create({
      data: {
        name: group.name,
        kind: group.kind,
        sortOrder: index,
        categories: {
          create: group.categories.map(([name, defaultLimitCents, fund], categoryIndex) => ({
            name,
            defaultLimitCents,
            type: fund ? 'fund' : 'standard',
            sortOrder: categoryIndex,
          })),
        },
      },
    });
  }
  return true;
}
