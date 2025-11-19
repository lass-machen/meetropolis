
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Dropping public schema...');
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    console.log('Public schema recreated. Database is empty.');
  } catch (e) {
    console.error('Failed to nuke DB:', e);
    process.exit(1);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

