# Database Migration Guide

## Overview

This guide explains how to manage database migrations for the Purchase Invoice system with pgvector support.

## Migration Options

### Option 1: Safe Migration (Preserves Existing Data) ✅ **RECOMMENDED**

Use this if you have existing data and want to add new columns without losing data:

```bash
npm run migrate:add-columns
```

**What it does:**
- Adds new columns to existing `PurchaseInvoice` table (if they don't exist)
- Creates `PurchaseInvoiceItem` table (if it doesn't exist)
- **Preserves all existing data**
- Safe to run multiple times

**When to use:**
- You have existing invoices in the database
- You want to add new fields without losing data
- Updating from old schema to new schema

---

### Option 2: Full Migration (Creates Everything)

Use this for fresh installations or when tables don't exist:

```bash
npm run migrate
```

**What it does:**
- Creates `PurchaseInvoice` table with all fields
- Creates `PurchaseInvoiceItem` table
- Creates all indexes including pgvector index
- Uses `CREATE TABLE IF NOT EXISTS` (safe to run multiple times)

**When to use:**
- Fresh database installation
- Tables don't exist yet
- Safe to run even if tables exist (won't overwrite)

---

### Option 3: Reset Database (⚠️ DELETES ALL DATA)

Use this only when you want to start completely fresh:

```bash
npm run reset-db
npm run migrate
```

**What it does:**
- **DELETES all data** in `PurchaseInvoice` and `PurchaseInvoiceItem` tables
- Drops both tables completely
- You must run `npm run migrate` after this

**When to use:**
- Development/testing only
- You want to start with a clean slate
- **NEVER use in production with real data!**

---

## Migration Scripts Explained

### 1. `migrate:add-columns` (Safe Migration)
- **File:** `src/scripts/migrate-add-columns.ts`
- **Purpose:** Adds new columns to existing tables
- **Safety:** ✅ Safe - preserves data
- **Idempotent:** ✅ Can run multiple times

### 2. `migrate` (Full Migration)
- **File:** `src/scripts/run-migration.ts`
- **Purpose:** Creates all tables and indexes
- **Safety:** ✅ Safe - uses IF NOT EXISTS
- **Idempotent:** ✅ Can run multiple times

### 3. `reset-db` (Reset Database)
- **File:** `src/scripts/reset-database.ts`
- **Purpose:** Drops all tables (deletes data)
- **Safety:** ⚠️ **DANGEROUS** - deletes all data
- **Idempotent:** ✅ Can run multiple times

---

## Recommended Workflow

### For Existing Database (with data):

```bash
# Step 1: Add new columns safely
npm run migrate:add-columns

# Step 2: Verify everything works
npm run check-db
```

### For Fresh Database:

```bash
# Step 1: Create all tables
npm run migrate

# Step 2: Verify everything works
npm run check-db
```

### For Development (reset everything):

```bash
# Step 1: Delete everything
npm run reset-db

# Step 2: Recreate tables
npm run migrate

# Step 3: Verify
npm run check-db
```

---

## What Gets Added in New Migration

### New Columns in `PurchaseInvoice`:
- `billDate` - Bill date
- `invoiceType` - Type of invoice (Regular/Credit/Cash)
- `taxNature` - Tax nature (GST/RCM/Exempt)
- `dueDate` - Credit due date
- `termsConditions` - Terms and conditions text
- `subtotal` - Subtotal amount
- `discountAmount` - Total discount
- `taxAmount` - Total tax
- `taxInclusive` - Tax inclusive flag

### New Table `PurchaseInvoiceItem`:
- Complete items table with product details, quantity, price, discount, tax, etc.

---

## Troubleshooting

### Error: "column already exists"
- This is normal if you run migration multiple times
- The script handles this gracefully
- Your data is safe

### Error: "relation does not exist"
- Run `npm run migrate` first to create tables
- Then run `npm run migrate:add-columns` if needed

### Error: "foreign key constraint"
- Make sure to drop items table before invoice table
- Use `reset-db` script which handles this correctly

---

## Safety Checklist

Before running any migration:

- [ ] Backup your database (if production)
- [ ] Check which option you need (add-columns vs full migration)
- [ ] Verify `DATABASE_URI` in `.env` is correct
- [ ] Test on development database first

---

## Summary

| Command | Purpose | Data Safety | When to Use |
|---------|---------|-------------|-------------|
| `npm run migrate:add-columns` | Add new columns | ✅ Safe | Existing data |
| `npm run migrate` | Create tables | ✅ Safe | Fresh install |
| `npm run reset-db` | Delete tables | ⚠️ Deletes data | Development only |

