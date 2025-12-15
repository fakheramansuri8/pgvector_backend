export class CreatePurchaseInvoiceDto {
  invoiceNumber: string;
  companyId: number;
  branchId: number;
  vendorAccountId?: number;
  invoiceDate: string;
  vendorName?: string;
  vendorReference?: string;
  billNumber?: string;
  narration?: string;
  totalAmount?: number;
}

