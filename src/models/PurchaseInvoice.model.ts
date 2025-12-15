import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';

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
    type: DataType.TEXT,
  })
  declare narration: string;

  @AllowNull(true)
  @Column({
    type: DataType.DECIMAL(12, 2),
    defaultValue: 0,
  })
  declare totalAmount: number;

  @AllowNull(true)
  @Column({
    type: DataType.TEXT,
    comment: 'Vector embedding for semantic search (stored as text array)',
  })
  declare embedding: string;

  @CreatedAt
  @Column(DataType.DATE)
  declare createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  declare updatedAt: Date;
}

