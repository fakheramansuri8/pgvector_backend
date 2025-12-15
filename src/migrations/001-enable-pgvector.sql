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
  "narration" TEXT,
  "totalAmount" DECIMAL(12, 2) DEFAULT 0,
  "embedding" vector(768),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
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

