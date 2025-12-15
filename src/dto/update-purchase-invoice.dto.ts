import { CreatePurchaseInvoiceItemDto } from './create-purchase-invoice-item.dto';

export class UpdatePurchaseInvoiceDto {
  invoiceNumber?: string;
  vendorAccountId?: number;
  invoiceDate?: string;
  vendorName?: string;
  vendorReference?: string;
  billNumber?: string;
  billDate?: string;
  invoiceType?: string;
  taxNature?: string;
  dueDate?: string;
  narration?: string;
  termsConditions?: string;
  subtotal?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  taxInclusive?: boolean;
  items?: CreatePurchaseInvoiceItemDto[];
}

