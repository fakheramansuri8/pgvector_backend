import { Sequelize } from 'sequelize';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

async function checkTable() {
  const databaseUri =
    process.env.DATABASE_URI ||
    'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db';

  if (!databaseUri) {
    console.error('❌ DATABASE_URI not found in environment variables');
    process.exit(1);
  }

  const sequelize = new Sequelize(databaseUri, {
    logging: false,
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    const [results] = await sequelize.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'PurchaseInvoice'
      ORDER BY ordinal_position;
    `);

    if (Array.isArray(results) && results.length > 0) {
      console.log('\n📊 PurchaseInvoice Table Structure:');
      console.table(results);
    } else {
      console.log('❌ PurchaseInvoice table does not exist');
    }

    const [extensions] = await sequelize.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector';
    `);

    if (Array.isArray(extensions) && extensions.length > 0) {
      console.log('\n✅ pgvector extension is installed');
      console.table(extensions);
    } else {
      console.log('\n❌ pgvector extension is NOT installed');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sequelize.close();
  }
}

checkTable();

