import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import Fuse from 'fuse.js';
import { closest } from 'fastest-levenshtein';
import { PurchaseInvoice } from '../models/PurchaseInvoice.model';
import { PurchaseInvoiceItem } from '../models/PurchaseInvoiceItem.model';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

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
    private readonly sequelize: Sequelize,
  ) {
    // Combine all static words
    this.staticDictionary = [
      ...this.actionWords,
      ...this.domainWords,
      ...this.keywordWords,
    ];
  }

  /**
   * Corrects typos in a query using fuzzy matching and phonetic matching
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
    const { corrected, matchedEntities } = this.correctMultiWordEntities(correctedQuery);
    correctedQuery = corrected;

    // 2. Then correct individual words using phonetic matching for names
    // But skip words that are already part of matched multi-word entities
    const words = correctedQuery.split(/(\s+)/);
    const correctedWords: string[] = [];
    const queryLower = correctedQuery.toLowerCase();

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

      // Check if this word is already part of a matched multi-word entity
      const wordLower = word.toLowerCase();
      const isPartOfMatchedEntity = matchedEntities.some(entity => {
        const entityLower = entity.toLowerCase();
        const entityWords = entityLower.split(/\s+/);
        // Check if word is one of the words in the entity and entity exists in the query
        return entityWords.includes(wordLower) && queryLower.includes(entityLower);
      });

      if (isPartOfMatchedEntity) {
        // Word is already part of a matched entity, keep it as is
        this.logger.debug(`[FUZZY] Skipping "${word}" - already part of matched entity`);
        correctedWords.push(word);
        continue;
      }

      // Use async phonetic matching for proper correction of names
      const corrected = await this.correctSingleWordAsync(word, correctedQuery, matchedEntities);
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
   * Returns both the corrected query and the list of matched entities
   */
  private correctMultiWordEntities(query: string): { corrected: string; matchedEntities: string[] } {
    let result = query;
    const matchedEntities: string[] = [];
    
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
        matchedEntities.push(vendor);
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
        matchedEntities.push(product);
      }
    }

    return { corrected: result, matchedEntities };
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
   * Corrects a single word using static dictionary (synchronous version for non-names)
   */
  private correctSingleWord(word: string): string {
    const wordLower = word.toLowerCase();
    const isCapitalized = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();

    // 1. Check if word is already correct in static dictionary
    if (this.staticDictionary.includes(wordLower)) {
      return word;
    }

    // 2. If word is capitalized (proper noun like "Deen"), use Fuse.js for now
    //    Phonetic matching is handled separately in correctSingleWordAsync
    if (isCapitalized) {
      // Try single-word vendor name matching using Fuse.js
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
   * Corrects a single word using phonetic matching (async version for names)
   * Uses PostgreSQL fuzzystrmatch for phonetic similarity
   */
  private async correctSingleWordAsync(
    word: string,
    currentQuery: string,
    matchedEntities: string[] = []
  ): Promise<string> {
    const wordLower = word.toLowerCase();
    
    // Skip phonetic matching for static dictionary words (action, domain, keyword words)
    // These are common words like "invoice", "show", "from", etc.
    if (this.staticDictionary.includes(wordLower)) {
      return this.correctSingleWord(word);
    }

    // Try phonetic matching for any word that could be a name
    // (both capitalized like "Gowrav" and lowercase like "gowrav")
    const phoneticMatch = await this.phoneticMatchVendor(word);
    if (phoneticMatch.wasChanged && phoneticMatch.confidence > 0.5) {
      const vendorName = phoneticMatch.corrected;
      const vendorWords = vendorName.split(/\s+/);
      const currentQueryLower = currentQuery.toLowerCase();
      
      // Check if the full vendor name is already in the query (as a matched entity or already present)
      const vendorAlreadyInQuery = matchedEntities.some(entity => 
        entity.toLowerCase() === vendorName.toLowerCase()
      ) || currentQueryLower.includes(vendorName.toLowerCase());
      
      if (vendorAlreadyInQuery) {
        // Vendor name already in query, return just the first word to avoid duplication
        this.logger.debug(
          `[PHONETIC] Vendor "${vendorName}" already in query, returning first word only: "${word}" → "${vendorWords[0]}" (confidence: ${phoneticMatch.confidence.toFixed(2)})`
        );
        return vendorWords[0];
      }
      
      // Only return full vendor name if it's a single word or very high confidence
      // For multi-word vendors, return only first word to avoid duplication
      if (vendorWords.length === 1 || phoneticMatch.confidence >= 0.95) {
        this.logger.debug(`[PHONETIC] Vendor match: "${word}" → "${vendorName}" (confidence: ${phoneticMatch.confidence.toFixed(2)})`);
        return vendorName;
      } else {
        // Multi-word vendor with moderate confidence - return first word only
        this.logger.debug(
          `[PHONETIC] Vendor match (first word only to avoid duplication): "${word}" → "${vendorWords[0]}" (full: "${vendorName}", confidence: ${phoneticMatch.confidence.toFixed(2)})`
        );
        return vendorWords[0];
      }
    }

    // Fall back to synchronous matching
    return this.correctSingleWord(word);
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
   * Phonetic match against vendor names using PostgreSQL fuzzystrmatch
   * Uses Soundex + Levenshtein for best results with names
   * Compares against first word of vendor name (first name) for better matching
   */
  async phoneticMatchVendor(word: string): Promise<FuzzyMatchResult> {
    if (!this.sequelize || this.vendorList.length === 0) {
      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    }

    try {
      // Query PostgreSQL for phonetic matches
      // Compare against first word (first name) of vendor name for better phonetic matching
      // Prioritize: 1) Soundex match + low Levenshtein, 2) Metaphone match, 3) Just low Levenshtein
      const results = await this.sequelize.query<{
        vendor_name: string;
        first_name: string;
        soundex_match: boolean;
        metaphone_match: boolean;
        edit_distance: number;
        phonetic_score: number;
      }>(
        `
        SELECT 
          "vendorName" as vendor_name,
          SPLIT_PART("vendorName", ' ', 1) as first_name,
          soundex(:word) = soundex(SPLIT_PART("vendorName", ' ', 1)) as soundex_match,
          dmetaphone(:word) = dmetaphone(SPLIT_PART("vendorName", ' ', 1)) as metaphone_match,
          levenshtein(LOWER(:word), LOWER(SPLIT_PART("vendorName", ' ', 1))) as edit_distance,
          CASE 
            WHEN soundex(:word) = soundex(SPLIT_PART("vendorName", ' ', 1)) THEN 
              1.0 - (levenshtein(LOWER(:word), LOWER(SPLIT_PART("vendorName", ' ', 1)))::float / 
                     GREATEST(LENGTH(:word), LENGTH(SPLIT_PART("vendorName", ' ', 1))))
            WHEN dmetaphone(:word) = dmetaphone(SPLIT_PART("vendorName", ' ', 1)) THEN
              0.8 - (levenshtein(LOWER(:word), LOWER(SPLIT_PART("vendorName", ' ', 1)))::float / 
                     GREATEST(LENGTH(:word), LENGTH(SPLIT_PART("vendorName", ' ', 1))) * 0.5)
            ELSE
              0.5 - (levenshtein(LOWER(:word), LOWER(SPLIT_PART("vendorName", ' ', 1)))::float / 
                     GREATEST(LENGTH(:word), LENGTH(SPLIT_PART("vendorName", ' ', 1))))
          END as phonetic_score
        FROM (SELECT DISTINCT "vendorName" FROM "PurchaseInvoice" WHERE "vendorName" IS NOT NULL) vendors
        WHERE 
          soundex(:word) = soundex(SPLIT_PART("vendorName", ' ', 1))
          OR dmetaphone(:word) = dmetaphone(SPLIT_PART("vendorName", ' ', 1))
          OR levenshtein(LOWER(:word), LOWER(SPLIT_PART("vendorName", ' ', 1))) <= 2
        ORDER BY 
          soundex_match DESC,
          metaphone_match DESC,
          edit_distance ASC
        LIMIT 5
        `,
        {
          replacements: { word },
          type: QueryTypes.SELECT,
        },
      );

      if (results.length > 0) {
        const best = results[0];
        
        this.logger.log(
          `[PHONETIC] Query "${word}" matched "${best.vendor_name}" (first_name: ${best.first_name}, soundex: ${best.soundex_match}, metaphone: ${best.metaphone_match}, score: ${best.phonetic_score.toFixed(2)})`,
        );

        // Accept if:
        // 1. Soundex matches (phonetically similar) OR
        // 2. Metaphone matches OR
        // 3. Edit distance <= 2 and phonetic_score > 0.5
        if (best.soundex_match || best.metaphone_match || (best.edit_distance <= 2 && best.phonetic_score > 0.5)) {
          // Boost confidence for soundex/metaphone matches (they're strong phonetic indicators)
          let confidence = Math.max(0, Math.min(1, best.phonetic_score));
          if (best.soundex_match && best.metaphone_match) {
            // Both match - very high confidence
            confidence = Math.max(confidence, 0.7);
          } else if (best.soundex_match || best.metaphone_match) {
            // One matches - good confidence
            confidence = Math.max(confidence, 0.6);
          }
          
          return {
            original: word,
            corrected: best.vendor_name,
            wasChanged: best.vendor_name.toLowerCase() !== word.toLowerCase(),
            confidence,
          };
        }
      } else {
        this.logger.debug(`[PHONETIC] No matches found for "${word}"`);
      }

      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    } catch (error) {
      this.logger.warn(`[PHONETIC] Error in phonetic match: ${error}`);
      return { original: word, corrected: word, wasChanged: false, confidence: 0 };
    }
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

