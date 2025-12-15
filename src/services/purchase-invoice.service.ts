import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from '../models/PurchaseInvoiceItem.model';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from '../dto/update-purchase-invoice.dto';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectModel(PurchaseInvoice)
    private purchaseInvoiceModel: typeof PurchaseInvoice,
    @InjectModel(PurchaseInvoiceItem)
    private purchaseInvoiceItemModel: typeof PurchaseInvoiceItem,
  ) {}

  async create(createDto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoice> {
    const { items, ...invoiceData } = createDto;
    
    // Convert date strings to Date objects
    const processedData: Record<string, unknown> = { ...invoiceData };
    if (invoiceData.invoiceDate) {
      processedData.invoiceDate = new Date(invoiceData.invoiceDate);
    }
    if (invoiceData.billDate) {
      processedData.billDate = new Date(invoiceData.billDate);
    }
    if (invoiceData.dueDate) {
      processedData.dueDate = new Date(invoiceData.dueDate);
    }

    // Create invoice with items in a transaction
    const sequelize = this.purchaseInvoiceModel.sequelize;
    if (!sequelize) {
      throw new Error('Sequelize instance not found');
    }

    return sequelize.transaction(async (transaction) => {
      const invoice = await this.purchaseInvoiceModel.create(
        processedData as unknown as PurchaseInvoice,
        { transaction },
      );

      // Create items if provided
      if (items && items.length > 0) {
        const itemsToCreate = items.map((item, index) => {
          // Validate and clamp discount percentage to 0-100
          let discountPercentage = item.discountPercentage || 0;
          if (discountPercentage > 100) discountPercentage = 100;
          if (discountPercentage < 0) discountPercentage = 0;

          return {
            ...item,
            discountPercentage,
            purchaseInvoiceId: invoice.id,
            srNo: item.srNo ?? index + 1,
          };
        });
        await this.purchaseInvoiceItemModel.bulkCreate(
          itemsToCreate as unknown as PurchaseInvoiceItem[],
          { transaction },
        );
      }

      // Reload with items
      return this.purchaseInvoiceModel.findByPk(invoice.id, {
        include: [PurchaseInvoiceItem],
        transaction,
      }) as Promise<PurchaseInvoice>;
    });
  }

  async findAll(filters?: { companyId?: number; branchId?: number }): Promise<PurchaseInvoice[]> {
    const where: Record<string, unknown> = {};
    if (filters?.companyId) {
      where.companyId = filters.companyId;
    }
    if (filters?.branchId) {
      where.branchId = filters.branchId;
    }
    return this.purchaseInvoiceModel.findAll({
      where,
      include: [PurchaseInvoiceItem],
      order: [['invoiceDate', 'DESC']],
    });
  }

  async findOne(id: number): Promise<PurchaseInvoice> {
    const invoice = await this.purchaseInvoiceModel.findByPk(id, {
      include: [PurchaseInvoiceItem],
    });
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
    const { items, ...invoiceData } = updateDto;
    const updateData: Record<string, unknown> = { ...invoiceData };
    
    // Convert date strings to Date if provided
    if (updateDto.invoiceDate) {
      updateData.invoiceDate = new Date(updateDto.invoiceDate);
    }
    if (updateDto.billDate) {
      updateData.billDate = new Date(updateDto.billDate);
    }
    if (updateDto.dueDate) {
      updateData.dueDate = new Date(updateDto.dueDate);
    }

    // Update invoice and items in a transaction
    const sequelize = this.purchaseInvoiceModel.sequelize;
    if (!sequelize) {
      throw new Error('Sequelize instance not found');
    }

    return sequelize.transaction(async (transaction) => {
      await invoice.update(updateData as unknown as PurchaseInvoice, { transaction });

      // Update items if provided
      if (items !== undefined) {
        // Delete existing items
        await this.purchaseInvoiceItemModel.destroy({
          where: { purchaseInvoiceId: id },
          transaction,
        });

        // Create new items
        if (items.length > 0) {
          const itemsToCreate = items.map((item, index) => {
            // Validate and clamp discount percentage to 0-100
            let discountPercentage = item.discountPercentage || 0;
            if (discountPercentage > 100) discountPercentage = 100;
            if (discountPercentage < 0) discountPercentage = 0;

            return {
              ...item,
              discountPercentage,
              purchaseInvoiceId: id,
              srNo: item.srNo ?? index + 1,
            };
          });
          await this.purchaseInvoiceItemModel.bulkCreate(
            itemsToCreate as unknown as PurchaseInvoiceItem[],
            { transaction },
          );
        }
      }

      // Reload with items
      return this.purchaseInvoiceModel.findByPk(id, {
        include: [PurchaseInvoiceItem],
        transaction,
      }) as Promise<PurchaseInvoice>;
    });
  }

  async remove(id: number): Promise<void> {
    const invoice = await this.findOne(id);
    await invoice.destroy(); // Items will be deleted due to CASCADE
  }
}

