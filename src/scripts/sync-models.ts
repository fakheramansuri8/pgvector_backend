import { Sequelize } from 'sequelize-typescript';
import { config } from 'dotenv';
import { resolve } from 'path';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

async function syncModels() {
  const databaseUri =
    process.env.DATABASE_URI ||
    'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db';

  if (!databaseUri) {
    console.error('❌ DATABASE_URI not found in environment variables');
    process.exit(1);
  }

  const sequelize = new Sequelize(databaseUri, {
    models: [PurchaseInvoice],
    logging: console.log,
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    console.log('📝 Syncing models...');
    console.log('⚠️  Note: This will NOT create the vector column type correctly.');
    console.log('⚠️  Use the SQL migration for proper vector support.');
    
    // Only sync if you want to create basic table structure
    // The vector column needs to be added manually via SQL
    await sequelize.sync({ alter: false, force: false });
    
    console.log('✅ Models synced (basic structure only)');
    console.log('⚠️  Remember to run SQL migration for vector column!');
  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

syncModels();

