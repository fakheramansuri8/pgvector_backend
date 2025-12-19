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
        dbEmbedding?: string;
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

        this.logger.log(`[SEARCH] Executing vector similarity search (limit: ${limit})`);
        this.logger.log(`[SEARCH] WHERE clause: ${embeddingWhereClause}`);
        this.logger.log(`[SEARCH] Replacements: limit=${replacements.limit}, queryEmbedding length=${(replacements.queryEmbedding as string)?.length || 0}`);
        
        try {
          // Workaround: Fetch ALL invoices without ORDER BY (which causes issues), then sort in JavaScript
          // ORDER BY with vector operator consistently returns 0 results, even with literal strings
          // Since we can't use ORDER BY, we need to fetch all invoices to ensure we get the best matches
          const querySql = `
            SELECT 
              id,
              "invoiceNumber",
              "invoiceDate",
              "vendorName",
              "vendorReference",
              "billNumber",
              narration,
              "totalAmount",
              embedding::text as "dbEmbedding",
              1 - (embedding <=> '${embeddingStr}'::vector) as "similarityScore"
            FROM "PurchaseInvoice"
            WHERE ${embeddingWhereClause}
          `;
          
          this.logger.log(`[SEARCH] About to execute main query (fetching all invoices, will sort and take top ${limit})...`);
          const rawResults = await this.purchaseInvoiceModel.sequelize?.query(
            querySql,
            {
              replacements,
              type: QueryTypes.SELECT,
            },
          ) as typeof results;
          
          // Sort by similarity score in JavaScript (descending - highest similarity first)
          if (rawResults && Array.isArray(rawResults)) {
            const sorted = rawResults.sort((a, b) => {
              const scoreA = Number(a.similarityScore) || 0;
              const scoreB = Number(b.similarityScore) || 0;
              return scoreB - scoreA; // Descending order (highest similarity first)
            });
            // Take only the top 'limit' results
            results = sorted.slice(0, limit);
            this.logger.log(`[SEARCH] Main query completed. Fetched ${rawResults.length} results, returning top ${results.length} (sorted by similarity)`);
          } else {
            results = [];
            this.logger.warn(`[SEARCH] Results is not an array: ${typeof rawResults}`);
          }
          if (results && results.length > 0) {
            this.logger.log(`[SEARCH] First result: id=${results[0].id}, vendor="${results[0].vendorName}", similarity=${(results[0].similarityScore as number).toFixed(4)}`);
          } else {
            // Test: Try queries to diagnose the issue
            this.logger.log(`[SEARCH] Testing diagnostic queries...`);
            
            // Test 1: Simple query without ORDER BY
            try {
              const testResults1 = await this.purchaseInvoiceModel.sequelize?.query(
                `
                SELECT 
                  id,
                  "vendorName",
                  1 - (embedding <=> :queryEmbedding::vector) as "similarityScore"
                FROM "PurchaseInvoice"
                WHERE embedding IS NOT NULL
                LIMIT 5
                `,
                {
                  replacements: { queryEmbedding: embeddingStr },
                  type: QueryTypes.SELECT,
                }
              ) as Array<{ id: number; vendorName: string; similarityScore: number }>;
              
              if (testResults1 && testResults1.length > 0) {
                this.logger.log(`[SEARCH] Test 1 (no ORDER BY): Found ${testResults1.length} results`);
              } else {
                this.logger.warn(`[SEARCH] Test 1 (no ORDER BY): 0 results`);
              }
            } catch (testError) {
              this.logger.error(`[SEARCH] Error in test 1:`, testError);
            }
            
            // Test 2: Query with ORDER BY (like main query)
            try {
              const testResults2 = await this.purchaseInvoiceModel.sequelize?.query(
                `
                SELECT 
                  id,
                  "vendorName",
                  1 - (embedding <=> :queryEmbedding::vector) as "similarityScore"
                FROM "PurchaseInvoice"
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> :queryEmbedding::vector ASC
                LIMIT 5
                `,
                {
                  replacements: { queryEmbedding: embeddingStr },
                  type: QueryTypes.SELECT,
                }
              ) as Array<{ id: number; vendorName: string; similarityScore: number }>;
              
              if (testResults2 && testResults2.length > 0) {
                this.logger.log(`[SEARCH] Test 2 (with ORDER BY): Found ${testResults2.length} results`);
                testResults2.forEach((r, idx) => {
                  this.logger.log(`[SEARCH] Test 2 result ${idx + 1}: id=${r.id}, vendor="${r.vendorName}", similarity=${r.similarityScore.toFixed(4)}`);
                });
              } else {
                this.logger.warn(`[SEARCH] Test 2 (with ORDER BY): 0 results`);
              }
            } catch (testError) {
              this.logger.error(`[SEARCH] Error in test 2:`, testError);
            }
          }
        } catch (error) {
          this.logger.error(`[SEARCH] Error executing main query:`, error);
          this.logger.error(`[SEARCH] Error details:`, JSON.stringify(error, null, 2));
          results = [];
        }
        
        // Log retrieved results from database
        if (results && results.length > 0) {
          this.logger.log(`[SEARCH] Retrieved ${results.length} results from database`);
          results.forEach((result, index) => {
            const similarity = (result.similarityScore as number);
            this.logger.log(
              `[SEARCH] Result ${index + 1}: id=${result.id}, vendor="${result.vendorName}", similarity=${similarity.toFixed(4)}`
            );
          });
        } else {
          this.logger.warn(`[SEARCH] No results found for query: "${normalizedQuery}"`);
          
          // Quick diagnostic: Test vector comparison on the specific vendor invoice if mentioned
          if (preprocessed.vendorNames && preprocessed.vendorNames.length > 0) {
            try {
              const vendorName = preprocessed.vendorNames[0];
              const directTest = await this.purchaseInvoiceModel.sequelize?.query(
                `
                SELECT 
                  id,
                  "vendorName",
                  1 - (embedding <=> :queryEmbedding::vector) as "similarityScore"
                FROM "PurchaseInvoice"
                WHERE embedding IS NOT NULL 
                  AND LOWER("vendorName") = LOWER(:vendorName)
                LIMIT 1
                `,
                {
                  replacements: {
                    queryEmbedding: embeddingStr,
                    vendorName: vendorName,
                  },
                  type: QueryTypes.SELECT,
                }
              ) as Array<{ id: number; vendorName: string; similarityScore: number }>;
              
              if (directTest && directTest.length > 0) {
                this.logger.log(`[SEARCH] Direct test on "${vendorName}": id=${directTest[0].id}, similarity=${directTest[0].similarityScore.toFixed(4)}`);
              }
            } catch (error) {
              this.logger.error(`[SEARCH] Error in direct vector test:`, error);
            }
          }
        }
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

      return results.map((result) => {
        // Remove dbEmbedding from result before returning
        const { dbEmbedding, ...rest } = result as any;
        return {
          id: rest.id,
          invoiceNumber: rest.invoiceNumber,
          invoiceDate: rest.invoiceDate,
          vendorName: rest.vendorName || '',
          vendorReference: rest.vendorReference || '',
          billNumber: rest.billNumber || '',
          narration: rest.narration || '',
          totalAmount: Number(rest.totalAmount) || 0,
          similarityScore: Number(rest.similarityScore) || 0,
        };
      });
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

