import { readFileSync } from 'fs';
import { join } from 'path';
import { Sequelize } from 'sequelize';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

async function resetDatabase() {
  const databaseUri =
    process.env.DATABASE_URI ||
    'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db';

  if (!databaseUri) {
    console.error('❌ DATABASE_URI not found in environment variables');
    process.exit(1);
  }

  const sequelize = new Sequelize(databaseUri, {
    logging: console.log,
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    console.log('⚠️  WARNING: This will DELETE ALL DATA in PurchaseInvoice tables!');
    console.log('📝 Resetting database...');

    // Drop tables in reverse order (items first due to foreign key)
    await sequelize.query('DROP TABLE IF EXISTS "PurchaseInvoiceItem" CASCADE;');
    console.log('✓ Dropped PurchaseInvoiceItem table');

    await sequelize.query('DROP TABLE IF EXISTS "PurchaseInvoice" CASCADE;');
    console.log('✓ Dropped PurchaseInvoice table');

    console.log('✅ Database reset completed!');
    console.log('📝 Now run: npm run migrate');
  } catch (error) {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

resetDatabase();

