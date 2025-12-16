import { Sequelize } from 'sequelize-typescript';
import { config } from 'dotenv';
import { resolve } from 'path';
import { faker } from '@faker-js/faker';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from '../models/PurchaseInvoiceItem.model';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

// Product names pool for variety
const productNames = [
  'Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones', 'Webcam', 'Printer', 'Scanner',
  'Tablet', 'Smartphone', 'Charger', 'Cable', 'USB Drive', 'Hard Drive', 'SSD', 'RAM',
  'Graphics Card', 'Motherboard', 'Processor', 'Cooling Fan', 'Power Supply', 'Case',
  'Desk', 'Chair', 'Lamp', 'Notebook', 'Pen', 'Pencil', 'Stapler', 'Paper Clips',
  'White Shirt', 'Blue Jeans', 'Sneakers', 'Jacket', 'Hat', 'Sunglasses', 'Watch',
  'Backpack', 'Wallet', 'Belt', 'Socks', 'T-Shirt', 'Sweater', 'Coat', 'Gloves',
  'Coffee Maker', 'Blender', 'Microwave', 'Refrigerator', 'Washing Machine', 'Dryer',
  'Vacuum Cleaner', 'Iron', 'Toaster', 'Kettle', 'Dishwasher', 'Oven', 'Stove'
];

const uomOptions = ['pcs', 'kg', 'g', 'ltr', 'ml', 'm', 'cm', 'box', 'pack', 'set'];
const invoiceTypes = ['Regular', 'Credit', 'Cash'];
const taxNatures = ['GST', 'RCM', 'Exempt'];

async function generateSampleInvoices(count: number = 500) {
  const databaseUri =
    process.env.DATABASE_URI ||
    'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db';

  if (!databaseUri) {
    console.error('❌ DATABASE_URI not found in environment variables');
    process.exit(1);
  }

  const sequelize = new Sequelize(databaseUri, {
    dialect: 'postgres',
    logging: false,
    models: [PurchaseInvoice, PurchaseInvoiceItem],
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Initialize embedding service
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not found - embeddings will not be generated');
    }
    const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    const embeddingService = apiKey ? {
      async generateEmbedding(text: string): Promise<number[]> {
        try {
          const model = genAI!.getGenerativeModel({ model: 'text-embedding-004' });
          const result = await model.embedContent(text);
          return result.embedding?.values || [];
        } catch (err) {
          // Fallback to embedding-001
          const model = genAI!.getGenerativeModel({ model: 'embedding-001' });
          const result = await model.embedContent(text);
          return result.embedding?.values || [];
        }
      },
      generateSearchableText(invoice: any): string {
        const parts: string[] = [];
        
        // 1. Vendor name (clean, no prefix)
        if (invoice.vendorName) {
          parts.push(invoice.vendorName);
        }
        
        // 2. Product names (from all items)
        if (invoice.items && invoice.items.length > 0) {
          const productNames = invoice.items
            .map((item: any) => item.productName)
            .filter((name: string) => name && name.trim().length > 0);
          if (productNames.length > 0) {
            parts.push(productNames.join('. '));
          }
        }
        
        // Note: Amount is NOT included in embedding - it's handled via filters for better accuracy
        // Amount embeddings don't work well for semantic search
        
        // 3. Date (invoice date)
        if (invoice.invoiceDate) {
          const dateStr = typeof invoice.invoiceDate === 'string' 
            ? invoice.invoiceDate 
            : invoice.invoiceDate.toISOString().split('T')[0];
          parts.push(dateStr);
        }
        
        return parts.join('. ');
      }
    } : null;

    console.log(`📝 Generating ${count} sample invoices...`);
    const startTime = Date.now();

    // Generate invoices in batches to avoid memory issues
    const batchSize = 50;
    let created = 0;

    for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, count);
      const batchCount = batchEnd - batchStart;

      console.log(`📦 Processing batch ${batch + 1}/${Math.ceil(count / batchSize)} (${batchStart + 1}-${batchEnd})...`);

      const invoices: Array<{
        invoiceNumber: string;
        companyId: number;
        branchId: number;
        vendorAccountId: number;
        invoiceDate: string;
        vendorName: string;
        vendorReference: string;
        billNumber: string;
        billDate: string;
        invoiceType: string;
        taxNature: string;
        dueDate: string;
        narration: string;
        termsConditions: string;
        subtotal: number;
        discountAmount: number;
        taxAmount: number;
        totalAmount: number;
        taxInclusive: boolean;
        items: Array<{
          productName: string;
          productCode: string;
          description: string;
          hsn: string;
          quantity: number;
          uom: string;
          price: number;
          total: number;
          discountAmount: number;
          discountPercentage: number;
          taxAmount: number;
          netTotal: number;
          srNo: number;
        }>;
      }> = [];

      for (let i = 0; i < batchCount; i++) {
        // Generate random invoice data
        const invoiceDate = faker.date.between({ 
          from: new Date('2024-01-01'), 
          to: new Date() 
        });
        const billDate = faker.date.between({ 
          from: invoiceDate, 
          to: new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000) 
        });
        const dueDate = faker.date.between({ 
          from: billDate, 
          to: new Date(billDate.getTime() + 60 * 24 * 60 * 60 * 1000) 
        });

        const vendorName = faker.person.fullName();
        const numItems = faker.number.int({ min: 1, max: 5 });
        const items: any[] = [];

        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;

        // Generate items
        for (let j = 0; j < numItems; j++) {
          const quantity = faker.number.float({ min: 1, max: 100, fractionDigits: 2 });
          const price = faker.number.float({ min: 10, max: 10000, fractionDigits: 2 });
          const total = quantity * price;
          const discountPercentage = faker.number.float({ min: 0, max: 30, fractionDigits: 2 });
          const discountAmount = (total * discountPercentage) / 100;
          const itemSubtotal = total - discountAmount;
          const taxAmount = faker.number.float({ min: 0, max: itemSubtotal * 0.18, fractionDigits: 2 });
          const netTotal = itemSubtotal + taxAmount;

          subtotal += itemSubtotal;
          totalDiscount += discountAmount;
          totalTax += taxAmount;

          items.push({
            productName: faker.helpers.arrayElement(productNames),
            productCode: faker.string.alphanumeric({ length: 8, casing: 'upper' }),
            description: faker.commerce.productDescription().substring(0, 100),
            hsn: faker.string.numeric(8),
            quantity,
            uom: faker.helpers.arrayElement(uomOptions),
            price,
            total,
            discountAmount,
            discountPercentage,
            taxAmount,
            netTotal,
            srNo: j + 1,
          });
        }

        const totalAmount = subtotal + totalTax;

        invoices.push({
          invoiceNumber: `INV-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
          companyId: faker.number.int({ min: 1, max: 3 }),
          branchId: faker.number.int({ min: 1, max: 5 }),
          vendorAccountId: faker.number.int({ min: 1, max: 100 }),
          invoiceDate: invoiceDate.toISOString().split('T')[0],
          vendorName,
          vendorReference: faker.string.alphanumeric({ length: 10 }),
          billNumber: `BILL-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
          billDate: billDate.toISOString().split('T')[0],
          invoiceType: faker.helpers.arrayElement(invoiceTypes),
          taxNature: faker.helpers.arrayElement(taxNatures),
          dueDate: dueDate.toISOString().split('T')[0],
          narration: faker.lorem.sentence(),
          termsConditions: faker.lorem.paragraph(),
          subtotal: parseFloat(subtotal.toFixed(2)),
          discountAmount: parseFloat(totalDiscount.toFixed(2)),
          taxAmount: parseFloat(totalTax.toFixed(2)),
          totalAmount: parseFloat(totalAmount.toFixed(2)),
          taxInclusive: faker.datatype.boolean(),
          items,
        });
      }

      // Insert invoices in transaction
      await sequelize.transaction(async (transaction) => {
        for (const invoiceData of invoices) {
          const items = invoiceData.items;
          const invoiceFields = {
            invoiceNumber: invoiceData.invoiceNumber,
            companyId: invoiceData.companyId,
            branchId: invoiceData.branchId,
            vendorAccountId: invoiceData.vendorAccountId,
            invoiceDate: invoiceData.invoiceDate,
            vendorName: invoiceData.vendorName,
            vendorReference: invoiceData.vendorReference,
            billNumber: invoiceData.billNumber,
            billDate: invoiceData.billDate,
            invoiceType: invoiceData.invoiceType,
            taxNature: invoiceData.taxNature,
            dueDate: invoiceData.dueDate,
            narration: invoiceData.narration,
            termsConditions: invoiceData.termsConditions,
            subtotal: invoiceData.subtotal,
            discountAmount: invoiceData.discountAmount,
            taxAmount: invoiceData.taxAmount,
            totalAmount: invoiceData.totalAmount,
            taxInclusive: invoiceData.taxInclusive,
          };

          // Create invoice
          const invoice = await PurchaseInvoice.create(
            invoiceFields as any,
            { transaction },
          );

          // Create items
          if (items && Array.isArray(items) && items.length > 0) {
            const itemsToCreate = items.map((item) => ({
              ...item,
              purchaseInvoiceId: invoice.id,
            }));
            await PurchaseInvoiceItem.bulkCreate(itemsToCreate as any, { transaction });
          }

          // Generate embedding if service is available
          if (embeddingService) {
            try {
              const invoiceWithItems = await PurchaseInvoice.findByPk(invoice.id, {
                include: [PurchaseInvoiceItem],
                transaction,
              });

              if (invoiceWithItems) {
                const searchableText = embeddingService.generateSearchableText({
                  invoiceDate: invoiceWithItems.invoiceDate,
                  vendorName: invoiceWithItems.vendorName,
                  totalAmount: invoiceWithItems.totalAmount,
                  items: invoiceWithItems.items?.map((item) => ({
                    productName: item.productName,
                  })),
                });

                const embedding = await embeddingService.generateEmbedding(searchableText);
                const embeddingStr = `[${embedding.join(',')}]`;
                await invoiceWithItems.update({ embedding: embeddingStr }, { transaction });
              }
            } catch (err) {
              console.warn(`⚠️  Failed to generate embedding for invoice ${invoice.id}:`, err);
            }
          }

          created++;
          if (created % 10 === 0) {
            process.stdout.write(`\r   ✓ Created ${created}/${count} invoices...`);
          }
        }
      });

      console.log(`\r   ✓ Batch ${batch + 1} completed (${created}/${count} invoices)`);
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Successfully generated ${created} sample invoices in ${duration}s`);
    console.log(`📊 Each invoice has 1-5 items with random products, prices, and discounts`);
  } catch (error) {
    console.error('❌ Error generating sample invoices:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Get count from command line argument or default to 500
const count = process.argv[2] ? parseInt(process.argv[2], 10) : 500;

if (isNaN(count) || count <= 0) {
  console.error('❌ Invalid count. Please provide a positive number.');
  process.exit(1);
}

generateSampleInvoices(count);

