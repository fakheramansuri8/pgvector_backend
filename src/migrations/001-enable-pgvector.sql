-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create PurchaseInvoice table if it doesn't exist
CREATE TABLE IF NOT EXISTS "PurchaseInvoice" (
  "id" SERIAL PRIMARY KEY,
  "invoiceNumber" VARCHAR(20) NOT NULL,
  "companyId" INTEGER NOT NULL,
  "branchId" INTEGER NOT NULL,
  "vendorAccountId" INTEGER,
  "invoiceDate" DATE NOT NULL,
  "vendorName" VARCHAR(255),
  "vendorReference" VARCHAR(255),
  "billNumber" VARCHAR(50),
  "billDate" DATE,
  "invoiceType" VARCHAR(50),
  "taxNature" VARCHAR(50),
  "dueDate" DATE,
  "narration" TEXT,
  "termsConditions" TEXT,
  "subtotal" DECIMAL(12, 2) DEFAULT 0,
  "discountAmount" DECIMAL(12, 2) DEFAULT 0,
  "taxAmount" DECIMAL(12, 2) DEFAULT 0,
  "totalAmount" DECIMAL(12, 2) DEFAULT 0,
  "taxInclusive" BOOLEAN DEFAULT false,
  "embedding" vector(768),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create PurchaseInvoiceItem table
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

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS purchase_invoice_embedding_idx 
ON "PurchaseInvoice" 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for common filters
CREATE INDEX IF NOT EXISTS purchase_invoice_company_branch_idx 
ON "PurchaseInvoice" ("companyId", "branchId");

CREATE INDEX IF NOT EXISTS purchase_invoice_date_idx 
ON "PurchaseInvoice" ("invoiceDate");

-- Create index for items
CREATE INDEX IF NOT EXISTS purchase_invoice_item_invoice_idx 
ON "PurchaseInvoiceItem" ("purchaseInvoiceId");

