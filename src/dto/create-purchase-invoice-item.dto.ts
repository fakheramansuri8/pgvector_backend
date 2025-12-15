export class CreatePurchaseInvoiceItemDto {
  productName?: string;
  productCode?: string;
  description?: string;
  hsn?: string;
  quantity: number;
  uom?: string;
  price: number;
  total: number;
  discountAmount?: number;
  discountPercentage?: number;
  taxAmount?: number;
  netTotal: number;
  srNo?: number;
}

