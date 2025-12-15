export class SearchPurchaseInvoiceDto {
  query: string;
  companyId?: number;
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

