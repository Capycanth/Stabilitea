import { createPrismaClient } from '../src/prisma/create-client.js';
import { seedStarterCategories } from '../src/prisma/starter-categories.js';

const prisma = createPrismaClient();

try {
  const inserted = await seedStarterCategories(prisma);
  console.log(inserted ? 'Inserted starter categories.' : 'Categories already exist; seed skipped.');
} finally {
  await prisma.$disconnect();
}
