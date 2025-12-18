import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import Fuse from 'fuse.js';
import { closest } from 'fastest-levenshtein';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from '../models/PurchaseInvoiceItem.model';

interface FuzzyMatchResult {
  original: string;
  corrected: string;
  wasChanged: boolean;
  confidence: number;
}

@Injectable()
export class FuzzyMatchingService {
  private readonly logger = new Logger(FuzzyMatchingService.name);

  // Static word lists for fast correction
  private readonly actionWords = [
    'find', 'show', 'get', 'search', 'list', 'display', 'fetch', 'retrieve',
    'look', 'give', 'bring', 'pull', 'view', 'see', 'check'
  ];

  private readonly domainWords = [
    'invoice', 'invoices', 'bill', 'bills', 'purchase', 'purchases',
    'order', 'orders', 'receipt', 'receipts', 'payment', 'payments',
    'transaction', 'transactions', 'expense', 'expenses', 'document', 'documents'
  ];

  private readonly keywordWords = [
    'from', 'for', 'with', 'by', 'to', 'between', 'and', 'or',
    'containing', 'including', 'last', 'next', 'this', 'that',
    'month', 'week', 'year', 'today', 'yesterday', 'tomorrow',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'rupees', 'rs', 'dollars', 'amount', 'total', 'vendor', 'supplier'
  ];

  // Combined static dictionary
  private readonly staticDictionary: string[];

  // Fuse instances for database entities (initialized lazily)
  private vendorFuse: Fuse<string> | null = null;
  private productFuse: Fuse<string> | null = null;
  private vendorList: string[] = [];
  private productList: string[] = [];
  private lastCacheUpdate: Date | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectModel(PurchaseInvoice)
    private readonly purchaseInvoiceModel: typeof PurchaseInvoice,
    @InjectModel(PurchaseInvoiceItem)
    private readonly invoiceItemModel: typeof PurchaseInvoiceItem,
  ) {
    // Combine all static words
    this.staticDictionary = [
      ...this.actionWords,
      ...this.domainWords,
      ...this.keywordWords,
    ];
  }

  /**
   * Corrects typos in a query using fuzzy matching
   * @param query The original query with potential typos
   * @returns Corrected query
   */
  async correctQuery(query: string): Promise<string> {
    if (!query?.trim()) return query;

    this.logger.debug(`[FUZZY] Original query: "${query}"`);

    // Refresh cache if needed
    await this.refreshEntityCache();

    let correctedQuery = query;

    // 1. First try to match multi-word vendor/product names (most important)
    correctedQuery = this.correctMultiWordEntities(correctedQuery);

    // 2. Then correct individual words (action words, domain words, etc.)
    const words = correctedQuery.split(/(\s+)/);
    const correctedWords: string[] = [];

    for (const word of words) {
      // Skip whitespace
      if (/^\s+$/.test(word)) {
        correctedWords.push(word);
        continue;
      }

      // Skip if word is too short (less than 3 chars) or is a number
      if (word.length < 3 || /^\d+$/.test(word)) {
        correctedWords.push(word);
        continue;
      }

      // Skip if word contains special characters (dates, amounts)
      if (/[₹$€£@#%]/.test(word)) {
        correctedWords.push(word);
        continue;
      }

      const corrected = this.correctSingleWord(word);
      correctedWords.push(corrected);
    }

    correctedQuery = correctedWords.join('');
    
    if (correctedQuery !== query) {
      this.logger.log(`[FUZZY] Corrected: "${query}" → "${correctedQuery}"`);
    }

    return correctedQuery;
  }

  /**
   * Correct multi-word entities (vendor names, product names) in the query
   */
  private correctMultiWordEntities(query: string): string {
    let result = query;
    
    // Count multi-word vendors for debugging
    const multiWordVendors = this.vendorList.filter(v => v.split(/\s+/).length >= 2);
    this.logger.debug(`[FUZZY] Checking ${multiWordVendors.length} multi-word vendors against query: "${query}"`);

    // Try to find and correct vendor names (check 2-3 word combinations)
    for (const vendor of this.vendorList) {
      const vendorWords = vendor.split(/\s+/);
      if (vendorWords.length < 2) continue; // Skip single-word vendors for now

      // Create a fuzzy pattern for this vendor
      const vendorMatch = this.findFuzzyPhrase(result, vendor);
      if (vendorMatch) {
        this.logger.debug(`[FUZZY] Multi-word vendor match: "${vendorMatch}" → "${vendor}"`);
        result = result.replace(vendorMatch, vendor);
      }
    }

    // Try to find and correct product names
    for (const product of this.productList) {
      const productWords = product.split(/\s+/);
      if (productWords.length < 2) continue;

      const productMatch = this.findFuzzyPhrase(result, product);
      if (productMatch) {
        this.logger.debug(`[FUZZY] Multi-word product match: "${productMatch}" → "${product}"`);
        result = result.replace(productMatch, product);
      }
    }

    return result;
  }

  /**
   * Find a fuzzy match for a multi-word phrase in the query
   */
  private findFuzzyPhrase(query: string, targetPhrase: string): string | null {
    const targetWords = targetPhrase.split(/\s+/);
    const queryWords = query.split(/\s+/);
    const targetLen = targetWords.length;

    // Slide through query words to find matching sequences
    for (let i = 0; i <= queryWords.length - targetLen; i++) {
      const candidateWords = queryWords.slice(i, i + targetLen);
      const candidate = candidateWords.join(' ');

      // Calculate similarity for each word pair
      let totalDistance = 0;
      let allMatch = true;

      for (let j = 0; j < targetLen; j++) {
        const dist = this.levenshteinDistance(
          candidateWords[j].toLowerCase(),
          targetWords[j].toLowerCase()
        );
        const maxLen = Math.max(candidateWords[j].length, targetWords[j].length);
        const similarity = 1 - (dist / maxLen);

        // Each word must be at least 60% similar
        if (similarity < 0.6) {
          allMatch = false;
          break;
        }
        totalDistance += dist;
      }

      // Accept if all words matched and total distance is reasonable
      if (allMatch && totalDistance <= targetLen * 2) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Corrects a single word using static dictionary
   */
  private correctSingleWord(word: string): string {
    const wordLower = word.toLowerCase();
    const isCapitalized = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();

    // 1. Check if word is already correct in static dictionary
    if (this.staticDictionary.includes(wordLower)) {
      return word;
    }

    // 2. If word is capitalized (proper noun like "Deen"), try vendor/product matching FIRST
    //    Don't match proper nouns against static dictionary (would turn "Deen" → "year")
    if (isCapitalized) {
      // Try single-word vendor name matching
      const vendorMatch = this.fuzzyMatchVendor(word);
      if (vendorMatch.wasChanged && vendorMatch.confidence > 0.6) {
        this.logger.debug(`[FUZZY] Vendor match: "${word}" → "${vendorMatch.corrected}"`);
        return vendorMatch.corrected;
      }

      // Try single-word product name matching
      const productMatch = this.fuzzyMatchProduct(word);
      if (productMatch.wasChanged && productMatch.confidence > 0.6) {
        this.logger.debug(`[FUZZY] Product match: "${word}" → "${productMatch.corrected}"`);
        return productMatch.corrected;
      }

      // Capitalized word not found in vendor/product - leave it unchanged (likely a name)
      return word;
    }

    // 3. For lowercase words, try static dictionary correction (action, domain, keyword words)
    const staticMatch = this.fuzzyMatchStatic(wordLower);
    if (staticMatch.wasChanged && staticMatch.confidence >= 0.5) {
      this.logger.debug(`[FUZZY] Static match: "${word}" → "${staticMatch.corrected}"`);
      return this.preserveCase(word, staticMatch.corrected);
    }

    // 4. Try single-word vendor name matching for lowercase too
    const vendorMatch = this.fuzzyMatchVendor(word);
    if (vendorMatch.wasChanged && vendorMatch.confidence > 0.6) {
      this.logger.debug(`[FUZZY] Vendor match: "${word}" → "${vendorMatch.corrected}"`);
      return vendorMatch.corrected;
    }

    // 5. Try single-word product name matching
    const productMatch = this.fuzzyMatchProduct(word);
    if (productMatch.wasChanged && productMatch.confidence > 0.6) {
      this.logger.debug(`[FUZZY] Product match: "${word}" → "${productMatch.corrected}"`);
      return productMatch.corrected;
    }

    // No match found, return original
    return word;
  }

  /**
   * Fuzzy match against static dictionary using Levenshtein distance
   */
  private fuzzyMatchStatic(word: string): FuzzyMatchResult {
    const wordLower = word.toLowerCase();
    
    // Find closest match
    const match = closest(wordLower, this.staticDictionary);
    
    if (!match) {
      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    }

    // Calculate confidence based on Levenshtein distance
    const distance = this.levenshteinDistance(wordLower, match);
    const maxLen = Math.max(word.length, match.length);
    const confidence = 1 - (distance / maxLen);

    // Accept if:
    // - distance <= 2 AND word lengths are similar (within 1 char difference)
    // - OR confidence > 0.6 (at least 60% similar)
    const lenDiff = Math.abs(word.length - match.length);
    if ((distance <= 2 && lenDiff <= 1) || confidence >= 0.6) {
      return {
        original: word,
        corrected: match,
        wasChanged: match !== wordLower,
        confidence,
      };
    }

    return { original: word, corrected: word, wasChanged: false, confidence: 0 };
  }

  /**
   * Fuzzy match against vendor names using Fuse.js
   */
  private fuzzyMatchVendor(word: string): FuzzyMatchResult {
    if (!this.vendorFuse || this.vendorList.length === 0) {
      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    }

    const results = this.vendorFuse.search(word);
    
    if (results.length > 0) {
      const bestMatch = results[0];
      const score = bestMatch.score ?? 1; // Default to 1 (no match) if undefined
      const confidence = 1 - score; // Fuse score is 0 (perfect) to 1 (no match)
      
      if (confidence > 0.6) {
        return {
          original: word,
          corrected: bestMatch.item,
          wasChanged: bestMatch.item.toLowerCase() !== word.toLowerCase(),
          confidence,
        };
      }
    }

    return { original: word, corrected: word, wasChanged: false, confidence: 0 };
  }

  /**
   * Fuzzy match against product names using Fuse.js
   */
  private fuzzyMatchProduct(word: string): FuzzyMatchResult {
    if (!this.productFuse || this.productList.length === 0) {
      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    }

    const results = this.productFuse.search(word);
    
    if (results.length > 0) {
      const bestMatch = results[0];
      const score = bestMatch.score ?? 1; // Default to 1 (no match) if undefined
      const confidence = 1 - score;
      
      if (confidence > 0.6) {
        return {
          original: word,
          corrected: bestMatch.item,
          wasChanged: bestMatch.item.toLowerCase() !== word.toLowerCase(),
          confidence,
        };
      }
    }

    return { original: word, corrected: word, wasChanged: false, confidence: 0 };
  }

  /**
   * Refresh vendor and product cache from database
   */
  private async refreshEntityCache(): Promise<void> {
    const now = new Date();
    
    // Check if cache is still valid
    if (this.lastCacheUpdate && 
        (now.getTime() - this.lastCacheUpdate.getTime()) < this.CACHE_TTL_MS) {
      return;
    }

    try {
      // Fetch unique vendor names
      const vendors = await this.purchaseInvoiceModel.findAll({
        attributes: ['vendorName'],
        group: ['vendorName'],
        raw: true,
      });
      
      this.vendorList = vendors
        .map((v: any) => v.vendorName)
        .filter((name: string) => name?.trim());

      // Create Fuse instance for vendors
      this.vendorFuse = new Fuse(this.vendorList, {
        threshold: 0.4, // 0 = exact match, 1 = match anything
        distance: 100,
        minMatchCharLength: 2,
      });

      // Fetch unique product names
      const products = await this.invoiceItemModel.findAll({
        attributes: ['productName'],
        group: ['productName'],
        raw: true,
      });

      this.productList = products
        .map((p: any) => p.productName)
        .filter((name: string) => name?.trim());

      // Create Fuse instance for products
      this.productFuse = new Fuse(this.productList, {
        threshold: 0.4,
        distance: 100,
        minMatchCharLength: 2,
      });

      this.lastCacheUpdate = now;
      this.logger.log(`[FUZZY] Cache refreshed: ${this.vendorList.length} vendors, ${this.productList.length} products`);
    } catch (error) {
      this.logger.error(`[FUZZY] Failed to refresh cache: ${error}`);
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Preserve the case pattern of the original word in the corrected word
   */
  private preserveCase(original: string, corrected: string): string {
    if (original === original.toUpperCase()) {
      return corrected.toUpperCase();
    }
    if (original === original.toLowerCase()) {
      return corrected.toLowerCase();
    }
    if (original[0] === original[0].toUpperCase()) {
      return corrected.charAt(0).toUpperCase() + corrected.slice(1).toLowerCase();
    }
    return corrected.toLowerCase();
  }

  /**
   * Get current cache stats (for debugging)
   */
  getCacheStats(): { vendors: number; products: number; lastUpdate: Date | null } {
    return {
      vendors: this.vendorList.length,
      products: this.productList.length,
      lastUpdate: this.lastCacheUpdate,
    };
  }
}

