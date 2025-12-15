import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  HasMany,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { PurchaseInvoiceItem } from './PurchaseInvoiceItem.model';

@Table({
  tableName: 'PurchaseInvoice',
  timestamps: true,
})
export class PurchaseInvoice extends Model<PurchaseInvoice> {
  @PrimaryKey
  @AutoIncrement
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(20),
  })
  declare invoiceNumber: string;

  @AllowNull(false)
  @Column({
    type: DataType.INTEGER,
  })
  declare companyId: number;

  @AllowNull(false)
  @Column({
    type: DataType.INTEGER,
  })
  declare branchId: number;

  @AllowNull(true)
  @Column({
    type: DataType.INTEGER,
  })
  declare vendorAccountId: number;

  @AllowNull(false)
  @Column({
    type: DataType.DATEONLY,
  })
  declare invoiceDate: Date;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(255),
  })
  declare vendorName: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(255),
  })
  declare vendorReference: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(50),
  })
  declare billNumber: string;

  @AllowNull(true)
  @Column({
    type: DataType.DATEONLY,
  })
  declare billDate: Date;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(50),
  })
  declare invoiceType: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(50),
  })
  declare taxNature: string;

  @AllowNull(true)
  @Column({
    type: DataType.DATEONLY,
  })
  declare dueDate: Date;

  @AllowNull(true)
  @Column({
    type: DataType.TEXT,
  })
  declare narration: string;

  @AllowNull(true)
  @Column({
    type: DataType.TEXT,
  })
  declare termsConditions: string;

  // Financial fields
  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare subtotal: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare discountAmount: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare taxAmount: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare totalAmount: number;

  @AllowNull(false)
  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare taxInclusive: boolean;

  @AllowNull(true)
  @Column({
    type: DataType.TEXT,
    comment: 'Vector embedding for semantic search (stored as text array)',
  })
  declare embedding: string;

  @HasMany(() => PurchaseInvoiceItem)
  declare items: PurchaseInvoiceItem[];

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;
}

