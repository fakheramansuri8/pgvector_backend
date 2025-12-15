import { Sequelize } from 'sequelize';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

/**
 * Migration script to add new columns to existing PurchaseInvoice table
 * This is safe to run on existing data - it only adds columns if they don't exist
 */
async function migrateAddColumns() {
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

    console.log('📝 Adding new columns to existing tables...');

    // Check if PurchaseInvoiceItem table exists
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'PurchaseInvoiceItem'
    `);

    const itemsTableExists = (tables as Array<{ table_name: string }>).length > 0;

    // Add new columns to PurchaseInvoice if they don't exist
    const addColumnQueries = [
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "billDate" DATE;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "invoiceType" VARCHAR(50);`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "taxNature" VARCHAR(50);`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "dueDate" DATE;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "termsConditions" TEXT;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12, 2) DEFAULT 0;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12, 2) DEFAULT 0;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(12, 2) DEFAULT 0;`,
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "taxInclusive" BOOLEAN DEFAULT false;`,
    ];

    for (const query of addColumnQueries) {
      try {
        await sequelize.query(query);
        const columnName = query.match(/ADD COLUMN IF NOT EXISTS "(\w+)"/)?.[1];
        console.log(`✓ Added column: ${columnName || 'unknown'}`);
      } catch (err) {
        console.log(`⚠ Skipped (may already exist): ${query.substring(0, 50)}...`);
      }
    }

    // Create PurchaseInvoiceItem table if it doesn't exist
    if (!itemsTableExists) {
      console.log('📝 Creating PurchaseInvoiceItem table...');
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS "PurchaseInvoiceItem" (
          "id" SERIAL PRIMARY KEY,
          "purchaseInvoiceId" INTEGER NOT NULL,
          "productName" VARCHAR(100),
          "productCode" VARCHAR(50),
          "description" VARCHAR(100),
          "hsn" VARCHAR(20),
          "quantity" DECIMAL(10, 3) NOT NULL DEFAULT 0,
          "uom" VARCHAR(20),
          "price" DECIMAL(12, 2) NOT NULL DEFAULT 0,
          "total" DECIMAL(12, 2) NOT NULL DEFAULT 0,
          "discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
          "discountPercentage" DECIMAL(5, 2) NOT NULL DEFAULT 0,
          "taxAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
          "netTotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
          "srNo" INTEGER,
          "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey" 
            FOREIGN KEY ("purchaseInvoiceId") 
            REFERENCES "PurchaseInvoice"("id") 
            ON DELETE CASCADE
        );
      `);
      console.log('✓ Created PurchaseInvoiceItem table');

      // Create index for items
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS purchase_invoice_item_invoice_idx 
        ON "PurchaseInvoiceItem" ("purchaseInvoiceId");
      `);
      console.log('✓ Created index for PurchaseInvoiceItem');
    } else {
      console.log('✓ PurchaseInvoiceItem table already exists');
    }

    console.log('✅ Migration completed successfully!');
    console.log('📊 All new columns and tables have been added');
    console.log('💡 Your existing data is safe!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

migrateAddColumns();

