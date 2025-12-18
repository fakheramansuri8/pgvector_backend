import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from '../models/PurchaseInvoiceItem.model';
import { EmbeddingService } from './embedding.service';
import { QueryPreprocessingService } from './query-preprocessing.service';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes } from 'sequelize';

interface SearchFilters {
  companyId?: number;
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
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
    private queryPreprocessingService: QueryPreprocessingService,
  ) {}

  async semanticSearch(
    query: string,
    filters: SearchFilters = {},
  ): Promise<SearchResult[]> {
    try {
      this.logger.log(`[SEARCH] Starting search with query: "${query}"`);
      this.logger.log(`[SEARCH] Provided filters:`, JSON.stringify(filters));
      
      // Preprocess query to extract entities and normalize (includes fuzzy matching)
      const preprocessed = await this.queryPreprocessingService.preprocessQuery(query);
      
      // Log if query was corrected by fuzzy matching
      if (preprocessed.correctedQuery) {
        this.logger.log(`[SEARCH] Query corrected: "${preprocessed.originalQuery}" → "${preprocessed.correctedQuery}"`);
      }
      
      // Use normalized query for embedding (without dates and amounts)
      const normalizedQuery = preprocessed.normalizedQuery?.trim() || '';
      
      // Check if we have meaningful semantic content to search
      const hasSemanticContent = normalizedQuery.length > 0;
      
      this.logger.log(`[SEARCH] Normalized query: "${normalizedQuery}"`);
      this.logger.log(`[SEARCH] Has semantic content: ${hasSemanticContent}`);
      this.logger.log(`[SEARCH] Preprocessed dates: dateFrom=${preprocessed.dateFrom}, dateTo=${preprocessed.dateTo}`);
      this.logger.log(`[SEARCH] Preprocessed amounts: amountMin=${preprocessed.amountMin}, amountMax=${preprocessed.amountMax}`);

      const limit = filters.limit || 20;

      // Build WHERE clause dynamically
      const whereConditions: string[] = [];
      const replacements: Record<string, unknown> = {
        limit: limit,
      };

      // companyId filter removed - search across all companies

      if (filters.branchId) {
        whereConditions.push('"branchId" = :branchId');
        replacements.branchId = filters.branchId;
      }

      // Use extracted dates from query preprocessing, or fall back to provided filters
      const dateFrom = preprocessed.dateFrom || filters.dateFrom;
      const dateTo = preprocessed.dateTo || filters.dateTo;

      if (dateFrom) {
        whereConditions.push('"invoiceDate" >= :dateFrom');
        replacements.dateFrom = dateFrom;
      }

      if (dateTo) {
        whereConditions.push('"invoiceDate" <= :dateTo');
        replacements.dateTo = dateTo;
      }

      // Use extracted amounts from query preprocessing, or fall back to provided filters
      const amountMin = preprocessed.amountMin ?? filters.amountMin;
      const amountMax = preprocessed.amountMax ?? filters.amountMax;

      if (amountMin !== undefined) {
        whereConditions.push('"totalAmount" >= :amountMin');
        replacements.amountMin = amountMin;
      }

      if (amountMax !== undefined) {
        whereConditions.push('"totalAmount" <= :amountMax');
        replacements.amountMax = amountMax;
      }

      // If no filters and no semantic content, return empty
      if (whereConditions.length === 0 && !hasSemanticContent) {
        return [];
      }

      // Build WHERE clause
      const whereClause = whereConditions.length > 0 
        ? whereConditions.join(' AND ')
        : '1=1'; // Always true if no filters

      let results: Array<{
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

      if (hasSemanticContent) {
        // Use semantic search with embeddings
        this.logger.log(`[SEARCH] Generating embedding for: "${normalizedQuery}"`);
        const queryEmbedding = await this.embeddingService.generateEmbedding(normalizedQuery);
        this.logger.log(`[SEARCH] Embedding generated, length: ${queryEmbedding.length}`);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        replacements.queryEmbedding = embeddingStr;

        // Add embedding condition
        const embeddingWhereClause = whereConditions.length > 0
          ? `embedding IS NOT NULL AND ${whereClause}`
          : 'embedding IS NOT NULL';

        results = await this.purchaseInvoiceModel.sequelize?.query(
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
          WHERE ${embeddingWhereClause}
          ORDER BY embedding <=> :queryEmbedding::vector ASC
          LIMIT :limit
          `,
          {
            replacements,
            type: QueryTypes.SELECT,
          },
        ) as typeof results;
      } else {
        // No semantic content - just use filters, order by date descending
        this.logger.log(`[SEARCH] No semantic content - using filtered query only (no embedding)`);
        results = await this.purchaseInvoiceModel.sequelize?.query(
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
            1.0 as "similarityScore"
          FROM "PurchaseInvoice"
          WHERE ${whereClause}
          ORDER BY "invoiceDate" DESC
          LIMIT :limit
          `,
          {
            replacements,
            type: QueryTypes.SELECT,
          },
        ) as typeof results;
      }

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

      // Load items if not already loaded
      const invoiceWithItems = await this.purchaseInvoiceModel.findByPk(invoiceId, {
        include: [PurchaseInvoiceItem],
      });

      if (!invoiceWithItems) {
        throw new Error(`Invoice with id ${invoiceId} not found`);
      }

      const searchableText = this.embeddingService.generateSearchableText({
        invoiceDate: invoiceWithItems.invoiceDate,
        vendorName: invoiceWithItems.vendorName,
        totalAmount: invoiceWithItems.totalAmount,
        items: invoiceWithItems.items?.map((item) => ({
          productName: item.productName,
        })),
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

