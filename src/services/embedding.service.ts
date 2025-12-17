import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not found in environment variables');
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.genAI) {
      throw new Error('Gemini API not initialized. Please set GEMINI_API_KEY environment variable.');
    }

    try {
      // Use text-embedding-004 (newer model with better quota)
      const model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(text);
      const embedding = result.embedding?.values || [];
      if (embedding.length === 0) {
        throw new Error('Empty embedding returned from Gemini API');
      }
      return embedding;
    } catch (error) {
      this.logger.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generates searchable text for embedding from invoice data.
   * ONLY includes vendor name and product names for semantic search.
   * Dates and amounts are handled via SQL filters for exact matching.
   */
  generateSearchableText(invoice: {
    invoiceDate?: Date | string;
    vendorName?: string;
    totalAmount?: number;
    items?: Array<{
      productName?: string;
    }>;
  }): string {
    const parts: string[] = [];

    // 1. Vendor name - primary search target
    if (invoice.vendorName?.trim()) {
      parts.push(invoice.vendorName.trim());
    }

    // 2. Product names (from all items)
    if (invoice.items && invoice.items.length > 0) {
      const productNames = invoice.items
        .map((item) => item.productName?.trim())
        .filter((name): name is string => !!name && name.length > 0);
      if (productNames.length > 0) {
        parts.push(productNames.join('. '));
      }
    }

    // NOTE: Date and Amount are NOT included in embedding
    // They are handled via SQL WHERE clauses for exact/range matching
    // Including them in embeddings dilutes semantic meaning of vendor/product names

    const searchableText = parts.join('. ');
    this.logger.debug(`[EMBEDDING] Searchable text: "${searchableText}"`);
    return searchableText;
  }
}

