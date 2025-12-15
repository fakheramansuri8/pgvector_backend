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

  generateSearchableText(invoice: {
    invoiceNumber?: string;
    invoiceDate?: Date | string;
    vendorName?: string;
    vendorReference?: string;
    billNumber?: string;
    narration?: string;
    totalAmount?: number;
  }): string {
    const parts: string[] = [];

    if (invoice.invoiceNumber) {
      parts.push(`Purchase Invoice ${invoice.invoiceNumber}`);
    }

    if (invoice.invoiceDate) {
      const dateStr = typeof invoice.invoiceDate === 'string' 
        ? invoice.invoiceDate 
        : invoice.invoiceDate.toISOString().split('T')[0];
      parts.push(`dated ${dateStr}`);
    }

    if (invoice.vendorName) {
      parts.push(`from vendor ${invoice.vendorName}`);
    }

    if (invoice.vendorReference) {
      parts.push(`with reference ${invoice.vendorReference}`);
    }

    if (invoice.billNumber) {
      parts.push(`Bill number: ${invoice.billNumber}`);
    }

    if (invoice.narration) {
      parts.push(`Narration: ${invoice.narration}`);
    }

    if (invoice.totalAmount) {
      parts.push(`Total amount: ${invoice.totalAmount}`);
    }

    return parts.join('. ') + '.';
  }
}

