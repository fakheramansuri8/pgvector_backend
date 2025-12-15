import { readFileSync } from 'fs';
import { join } from 'path';
import { Sequelize } from 'sequelize';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

async function runMigration() {
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

    const migrationPath = join(__dirname, '../migrations/001-enable-pgvector.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📝 Running migration...');
    
    // Execute statements one by one, handling multi-line SQL properly
    // Split by semicolon but keep track of statement boundaries
    const lines = migrationSQL.split('\n');
    let currentStatement = '';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('--')) {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // If line ends with semicolon, execute the statement
      if (trimmedLine.endsWith(';')) {
        const statement = currentStatement.trim();
        if (statement) {
          try {
            await sequelize.query(statement);
            console.log(`✓ Executed: ${statement.substring(0, 50)}...`);
          } catch (err) {
            // If table/index already exists, that's okay
            if (err instanceof Error && err.message.includes('already exists')) {
              console.log(`⚠ Skipped (already exists): ${statement.substring(0, 50)}...`);
            } else {
              throw err;
            }
          }
        }
        currentStatement = '';
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log('📊 Table "PurchaseInvoice" created with vector support');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();

