import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { EmbeddingService } from './embedding.service';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes } from 'sequelize';

interface SearchFilters {
  companyId?: number;
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface SearchResult {
  id: number;
  invoiceNumber: string;
  invoiceDate: Date;
  vendorName: string;
  vendorReference: string;
  billNumber: string;
  narration: string;
  totalAmount: number;
  similarityScore: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectModel(PurchaseInvoice)
    private purchaseInvoiceModel: typeof PurchaseInvoice,
    private embeddingService: EmbeddingService,
  ) {}

  async semanticSearch(
    query: string,
    filters: SearchFilters = {},
  ): Promise<SearchResult[]> {
    try {
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      const limit = filters.limit || 20;

      // Build WHERE clause dynamically
      const whereConditions: string[] = ['embedding IS NOT NULL'];
      const replacements: Record<string, unknown> = {
        queryEmbedding: embeddingStr,
        limit: limit,
      };

      if (filters.companyId) {
        whereConditions.push('"companyId" = :companyId');
        replacements.companyId = filters.companyId;
      }

      if (filters.branchId) {
        whereConditions.push('"branchId" = :branchId');
        replacements.branchId = filters.branchId;
      }

      if (filters.dateFrom) {
        whereConditions.push('"invoiceDate" >= :dateFrom');
        replacements.dateFrom = filters.dateFrom;
      }

      if (filters.dateTo) {
        whereConditions.push('"invoiceDate" <= :dateTo');
        replacements.dateTo = filters.dateTo;
      }

      const whereClause = whereConditions.join(' AND ');

      // Use raw query to properly get similarity scores
      const results = await this.purchaseInvoiceModel.sequelize?.query(
        `
        SELECT 
          id,
          "invoiceNumber",
          "invoiceDate",
          "vendorName",
          "vendorReference",
          "billNumber",
          narration,
          "totalAmount",
          1 - (embedding <=> :queryEmbedding::vector) as "similarityScore"
        FROM "PurchaseInvoice"
        WHERE ${whereClause}
        ORDER BY embedding <=> :queryEmbedding::vector ASC
        LIMIT :limit
        `,
        {
          replacements,
          type: QueryTypes.SELECT,
        },
      ) as Array<{
        id: number;
        invoiceNumber: string;
        invoiceDate: Date;
        vendorName: string | null;
        vendorReference: string | null;
        billNumber: string | null;
        narration: string | null;
        totalAmount: number | string;
        similarityScore: number;
      }>;

      if (!results) {
        return [];
      }

      return results.map((result) => ({
        id: result.id,
        invoiceNumber: result.invoiceNumber,
        invoiceDate: result.invoiceDate,
        vendorName: result.vendorName || '',
        vendorReference: result.vendorReference || '',
        billNumber: result.billNumber || '',
        narration: result.narration || '',
        totalAmount: Number(result.totalAmount) || 0,
        similarityScore: Number(result.similarityScore) || 0,
      }));
    } catch (error) {
      this.logger.error('Error in semantic search:', error);
      throw error;
    }
  }

  async generateAndStoreEmbedding(invoiceId: number): Promise<void> {
    try {
      const invoice = await this.purchaseInvoiceModel.findByPk(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice with id ${invoiceId} not found`);
      }

      const searchableText = this.embeddingService.generateSearchableText({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        vendorName: invoice.vendorName,
        vendorReference: invoice.vendorReference,
        billNumber: invoice.billNumber,
        narration: invoice.narration,
        totalAmount: invoice.totalAmount,
      });

      const embedding = await this.embeddingService.generateEmbedding(searchableText);
      const embeddingStr = `[${embedding.join(',')}]`;

      await invoice.update({ embedding: embeddingStr });
    } catch (error) {
      this.logger.error(`Error generating embedding for invoice ${invoiceId}:`, error);
      throw error;
    }
  }
}

