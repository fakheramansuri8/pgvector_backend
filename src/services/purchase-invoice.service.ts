import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from '../dto/update-purchase-invoice.dto';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectModel(PurchaseInvoice)
    private purchaseInvoiceModel: typeof PurchaseInvoice,
  ) {}

  async create(createDto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoice> {
    return this.purchaseInvoiceModel.create(createDto as unknown as PurchaseInvoice);
  }

  async findAll(filters?: { companyId?: number; branchId?: number }): Promise<PurchaseInvoice[]> {
    const where: Record<string, unknown> = {};
    if (filters?.companyId) {
      where.companyId = filters.companyId;
    }
    if (filters?.branchId) {
      where.branchId = filters.branchId;
    }
    return this.purchaseInvoiceModel.findAll({ where });
  }

  async findOne(id: number): Promise<PurchaseInvoice> {
    const invoice = await this.purchaseInvoiceModel.findByPk(id);
    if (!invoice) {
      throw new NotFoundException(`Purchase Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  async update(
    id: number,
    updateDto: UpdatePurchaseInvoiceDto,
  ): Promise<PurchaseInvoice> {
    const invoice = await this.findOne(id);
    const updateData: Record<string, unknown> = { ...updateDto };
    
    // Convert invoiceDate string to Date if provided
    if (updateDto.invoiceDate) {
      updateData.invoiceDate = new Date(updateDto.invoiceDate);
    }
    
    await invoice.update(updateData as unknown as PurchaseInvoice);
    return invoice.reload();
  }

  async remove(id: number): Promise<void> {
    const invoice = await this.findOne(id);
    await invoice.destroy();
  }
}

