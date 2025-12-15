import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { PurchaseInvoice } from './PurchaseInvoice.model';

@Table({
  tableName: 'PurchaseInvoiceItem',
  timestamps: true,
})
export class PurchaseInvoiceItem extends Model<PurchaseInvoiceItem> {
  @PrimaryKey
  @AutoIncrement
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => PurchaseInvoice)
  @AllowNull(false)
  @Column({
    type: DataType.INTEGER,
  })
  declare purchaseInvoiceId: number;

  @BelongsTo(() => PurchaseInvoice)
  declare purchaseInvoice: PurchaseInvoice;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(100),
  })
  declare productName: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(50),
  })
  declare productCode: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(100),
  })
  declare description: string;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(20),
  })
  declare hsn: string;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(10, 3),
    defaultValue: 0,
  })
  declare quantity: number;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(20),
  })
  declare uom: string;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare price: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare total: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare discountAmount: number;

  @AllowNull(false)
  @Column({
    type: DataType.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Discount percentage (0-100)',
  })
  declare discountPercentage: number;

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
  declare netTotal: number;

  @AllowNull(true)
  @Column({
    type: DataType.INTEGER,
  })
  declare srNo: number;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;
}

