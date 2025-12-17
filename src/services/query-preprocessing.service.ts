import { Injectable, Logger } from '@nestjs/common';
import * as chrono from 'chrono-node';
import nlp from 'compromise';

export interface PreprocessedQuery {
  normalizedQuery: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  vendorNames?: string[];
  productNames?: string[];
}

@Injectable()
export class QueryPreprocessingService {
  private readonly logger = new Logger(QueryPreprocessingService.name);

  // Month names for date parsing
  private readonly monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  // Month name regex pattern (reused across methods)
  private readonly monthPattern = this.monthNames.join('|');

  // Currency patterns (reused in extraction and removal)
  private readonly currencySymbolPattern = /[₹$€£]\s*(\d+(?:[.,]\d+)?)/g;
  private readonly currencyBeforePattern = /(?:rupees?|rs\.?|dollars?|usd|eur|gbp)\s+(\d+(?:[.,]\d+)?)/gi;
  private readonly currencyAfterPattern = /(\d+(?:[.,]\d+)?)\s*(?:rupees?|rs\.?|dollars?|usd|eur|gbp)/gi;

  // Domain words that should not be extracted as entities
  private readonly domainWords = new Set([
    'invoice', 'invoices', 'bill', 'bills', 'payment', 'payments',
    'purchase', 'purchases', 'order', 'orders', 'transaction', 'transactions',
    'receipt', 'receipts', 'document', 'documents', 'record', 'records',
    'expense', 'expenses', 'cost', 'costs', 'price', 'prices',
    'vendor', 'vendors', 'supplier', 'suppliers', 'client', 'clients',
    'customer', 'customers', 'company', 'companies', 'business',
    'service', 'services', 'tax', 'taxes', 'fee', 'fees',
    'date', 'dates', 'month', 'months', 'week', 'weeks', 'year', 'years',
    'day', 'days', 'time', 'today', 'yesterday', 'tomorrow'
  ]);

  // Currency words
  private readonly currencyWords = new Set([
    'rupees', 'rupee', 'rs', 'rs.', 'dollars', 'dollar', 'usd', 'eur', 'gbp',
    'pounds', 'pound', 'euros', 'euro', 'currency', 'money', 'amount', 'amounts',
    'total', 'subtotal', 'balance', 'credit', 'debit'
  ]);

  // Time-related words
  private readonly timeWords = new Set([
    'last', 'next', 'previous', 'current', 'recent', 'past', 'future',
    'first', 'second', 'third', 'latest', 'earliest', 'oldest', 'newest'
  ]);

  // Common stop words that don't contribute to semantic meaning
  private readonly stopWords = new Set([
    'find',
    'get',
    'show',
    'display',
    'search',
    'look',
    'list',
    'lists',
    'for',
    'the',
    'a',
    'an',
    'this',
    'that',
    'these',
    'those',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'should',
    'could',
    'may',
    'might',
    'can',
    'must',
    'to',
    'from',
    'in',
    'on',
    'at',
    'by',
    'with',
    'of',
    'about',
    'into',
    'onto',
    'up',
    'down',
    'out',
    'off',
    'over',
    'under',
    'above',
    'below',
    'me',
    'my',
    'myself',
    'we',
    'our',
    'ours',
    'ourselves',
    'you',
    'your',
    'yours',
    'yourself',
    'yourselves',
    'he',
    'him',
    'his',
    'himself',
    'she',
    'amount',
    'amounts',
    'her',
    'hers',
    'herself',
    'it',
    'its',
    'itself',
    'they',
    'them',
    'their',
    'theirs',
    'themselves',
    'what',
    'which',
    'who',
    'whom',
    'whose',
    'where',
    'when',
    'why',
    'how',
    'all',
    'each',
    'every',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'not',
    'only',
    'own',
    'same',
    'so',
    'than',
    'too',
    'very',
    'just',
    'now',
    'any',
    'invoice',
    'invoices',
    'bill',
    'bills',
  ]);

  /**
   * Preprocesses a user query to extract entities and normalize for embedding
   */
  preprocessQuery(query: string): PreprocessedQuery {
    this.logger.log(`[PREPROCESS] Original query: "${query}"`);

    if (!query || !query.trim()) {
      this.logger.log(`[PREPROCESS] Empty query, returning empty result`);
      return { normalizedQuery: '' };
    }

    const trimmedQuery = query.trim();
    const originalQuery = trimmedQuery.toLowerCase();
    let workingQuery = originalQuery;
    this.logger.log(`[PREPROCESS] Lowercase query: "${workingQuery}"`);

    // CRITICAL: Extract entities BEFORE lowercasing to preserve proper noun capitalization
    // Extract vendor names and product names from original query (with capitalization)
    const vendorInfo = this.extractVendorNames(trimmedQuery);
    const productInfo = this.extractProductNames(trimmedQuery, vendorInfo.vendorNames || []);

    // 1. Extract dates (works fine with lowercase)
    const dateInfo = this.extractDates(workingQuery);
    this.logger.debug(`[NER] Dates extracted: ${JSON.stringify(dateInfo)}`);
    
    if (dateInfo.dateFrom || dateInfo.dateTo) {
      // Remove date-related text from query
      const beforeDateRemoval = workingQuery;
      workingQuery = this.removeDateText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After date removal: "${beforeDateRemoval}" -> "${workingQuery}"`);
    }

    // 2. Extract amounts (works fine with lowercase)
    const amountInfo = this.extractAmounts(workingQuery);
    this.logger.debug(`[NER] Amounts extracted: ${JSON.stringify(amountInfo)}`);
    
    if (amountInfo.amountMin !== undefined || amountInfo.amountMax !== undefined) {
      // Remove amount-related text from query
      const beforeAmountRemoval = workingQuery;
      workingQuery = this.removeAmountText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After amount removal: "${beforeAmountRemoval}" -> "${workingQuery}"`);
    }
    
    this.logger.debug(`[NER] Vendor names extracted: ${JSON.stringify(vendorInfo)}`);
    this.logger.debug(`[NER] Product names extracted: ${JSON.stringify(productInfo)}`);

    // 4. Remove stop words
    const beforeStopWordRemoval = workingQuery;
    let normalizedQuery = this.removeStopWords(workingQuery);
    this.logger.log(`[PREPROCESS] After stop word removal: "${beforeStopWordRemoval}" -> "${normalizedQuery}"`);
    
    // IMPORTANT: Restore original case of vendor/product names for better embedding matching
    // Stored embeddings use original case, so query embeddings should too
    const vendorNames = vendorInfo.vendorNames || [];
    const productNames = productInfo.productNames || [];
    
    for (const vendor of vendorNames) {
      const vendorLower = vendor.toLowerCase();
      // Replace lowercase version with original case
      normalizedQuery = normalizedQuery.replace(new RegExp(this.escapeRegex(vendorLower), 'gi'), vendor);
    }
    
    for (const product of productNames) {
      const productLower = product.toLowerCase();
      normalizedQuery = normalizedQuery.replace(new RegExp(this.escapeRegex(productLower), 'gi'), product);
    }
    
    const finalNormalized = normalizedQuery.trim();
    this.logger.debug(`[NER] Final normalized query for embedding: "${finalNormalized}"`);
    
    const finalResult = {
      normalizedQuery: finalNormalized,
      ...dateInfo,
      ...amountInfo,
      vendorNames: vendorInfo.vendorNames,
      productNames: productInfo.productNames,
    };
    
    this.logger.log(`[NER] Extraction complete: ${JSON.stringify(finalResult)}`);

    return finalResult;
  }

  /**
   * Extracts date information from query using NER (compromise) and chrono-node
   */
  private extractDates(query: string): { dateFrom?: string; dateTo?: string } {
    try {
      const now = new Date();
      const queryLower = query.toLowerCase();

      // Try NER first using compromise (for relative dates like "today", "yesterday")
      try {
        const doc = nlp(query);
        const dates = doc.match('#Date');
        if (dates.length > 0) {
          this.logger.debug(`[NER] Found ${dates.length} date matches`);
          
          // Check for specific relative dates that compromise recognizes
          const dateTexts = dates.out('array') as string[];
          for (const dateText of dateTexts) {
            const lower = dateText.toLowerCase();
            
            // Handle "today" - return immediately
            if (lower === 'today') {
              const today = new Date();
              const dateStr = this.formatDate(today);
              this.logger.debug(`[NER] Extracted "today" as: ${dateStr}`);
              return { dateFrom: dateStr, dateTo: dateStr };
            }
            
            // Handle "yesterday" - return immediately
            if (lower === 'yesterday') {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const dateStr = this.formatDate(yesterday);
              this.logger.debug(`[NER] Extracted "yesterday" as: ${dateStr}`);
              return { dateFrom: dateStr, dateTo: dateStr };
            }
            
            // Handle "tomorrow" - return immediately  
            if (lower === 'tomorrow') {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const dateStr = this.formatDate(tomorrow);
              this.logger.debug(`[NER] Extracted "tomorrow" as: ${dateStr}`);
              return { dateFrom: dateStr, dateTo: dateStr };
            }
          }
          
          this.logger.debug(`[NER] Found dates but no simple relative match, using chrono-node`);
        } else {
          this.logger.debug(`[NER] No date matches in query: "${query}"`);
        }
      } catch (nerError) {
        this.logger.debug(`[NER] Date extraction failed, falling back to chrono-node: ${nerError}`);
      }

      // Handle "last [month]" pattern explicitly (e.g., "last april", "last month")
      const lastMonthRegex = new RegExp(`\\blast\\s+(${this.monthPattern})\\b`);
      const lastMonthMatch = queryLower.match(lastMonthRegex);
      if (lastMonthMatch) {
        const monthName = lastMonthMatch[1];
        this.logger.debug(`[NER] Found "last ${monthName}" pattern`);
        const monthIndex = this.getMonthIndex(monthName);
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-11

        // If the month hasn't occurred this year, use last year
        // Otherwise, use this year
        let targetYear = currentYear;
        if (monthIndex > currentMonth) {
          targetYear = currentYear - 1;
        }

        // Get first and last day of that month
        const firstDay = new Date(targetYear, monthIndex, 1);
        const lastDay = new Date(targetYear, monthIndex + 1, 0); // Last day of month

        const result = {
          dateFrom: this.formatDate(firstDay),
          dateTo: this.formatDate(lastDay),
        };
        this.logger.debug(`[NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Handle "last month" (previous calendar month)
      if (/\blast\s+month\b/.test(queryLower)) {
        this.logger.debug(`[NER] Found "last month" pattern`);
        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        const result = {
          dateFrom: this.formatDate(firstDayLastMonth),
          dateTo: this.formatDate(lastDayLastMonth),
        };
        this.logger.debug(`[NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Handle "last week" (previous 7 days from today, or previous Monday-Sunday)
      if (/\blast\s+week\b/.test(queryLower)) {
        this.logger.debug(`[NER] Found "last week" pattern`);
        const today = new Date(now);
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        
        // Calculate last Monday (or Sunday if week starts on Sunday)
        // Using Monday as week start (ISO standard)
        const daysToLastMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7;
        const lastMonday = new Date(today);
        lastMonday.setDate(today.getDate() - daysToLastMonday);
        lastMonday.setHours(0, 0, 0, 0);

        const lastSunday = new Date(lastMonday);
        lastSunday.setDate(lastMonday.getDate() + 6);
        lastSunday.setHours(23, 59, 59, 999);

        const result = {
          dateFrom: this.formatDate(lastMonday),
          dateTo: this.formatDate(lastSunday),
        };
        this.logger.debug(`[NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Check for month + year pattern (e.g., "november 2025", "december 2024")
      const monthYearRegex = new RegExp(`\\b(${this.monthPattern})\\s+(\\d{4})\\b`);
      const monthYearMatch = queryLower.match(monthYearRegex);
      if (monthYearMatch) {
        const monthName = monthYearMatch[1];
        const year = parseInt(monthYearMatch[2], 10);
        const monthIndex = this.getMonthIndex(monthName);
        
        this.logger.debug(`[NER] Found month+year pattern: "${monthName} ${year}"`);
        
        // Get first and last day of that month
        const firstDay = new Date(year, monthIndex, 1);
        const lastDay = new Date(year, monthIndex + 1, 0); // Last day of month
        
        const result = {
          dateFrom: this.formatDate(firstDay),
          dateTo: this.formatDate(lastDay),
        };
        this.logger.debug(`[NER] Extracted month range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Parse dates from the query with current date as reference
      this.logger.debug(`[NER] Using chrono-node to parse dates from: "${query}"`);
      const parsedDates = chrono.parse(query, now);
      this.logger.debug(`[NER] Chrono-node found ${parsedDates.length} date matches`);

      if (parsedDates.length === 0) {
        this.logger.debug(`[NER] No dates extracted`);
        return {};
      }

      // Handle different date patterns
      const dates: Date[] = [];
      let hasRange = false;

      for (const parsed of parsedDates) {
        if (parsed.start) {
          dates.push(parsed.start.date());
        }
        if (parsed.end) {
          dates.push(parsed.end.date());
          hasRange = true;
        }
      }

      if (dates.length === 0) {
        return {};
      }

      // Sort dates
      dates.sort((a, b) => a.getTime() - b.getTime());

      // If we have a range from chrono, use it
      if (hasRange && dates.length >= 2) {
        const dateFrom = this.formatDate(dates[0]);
        const dateTo = this.formatDate(dates[dates.length - 1]);
        return { dateFrom, dateTo };
      }

      // Single date - search for that specific day
      if (dates.length === 1) {
        const date = dates[0];
        const dateStr = this.formatDate(date);
        this.logger.debug(`[NER] Extracted single date: ${dateStr}`);
        return { dateFrom: dateStr, dateTo: dateStr };
      }

      // Multiple dates - use as range
      const dateFrom = this.formatDate(dates[0]);
      const dateTo = this.formatDate(dates[dates.length - 1]);
      this.logger.debug(`[NER] Extracted date range: ${dateFrom} to ${dateTo}`);
      return { dateFrom, dateTo };
    } catch (error) {
      this.logger.warn(`Error extracting dates from query: ${query}`, error);
      return {};
    }
  }

  /**
   * Gets month index (0-11) from month name
   */
  private getMonthIndex(monthName: string): number {
    const index = this.monthNames.indexOf(monthName.toLowerCase());
    return index >= 0 ? index : 0;
  }

  /**
   * Removes date-related text from query
   */
  private removeDateText(query: string): string {
    const datePatterns = [
      /\b(today|yesterday|tomorrow)\b/gi,
      new RegExp(`\\b(last|next)\\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|${this.monthPattern})\\b`, 'gi'),
      /\b(this|that)\s+(day|week|month|year)\b/gi,
      /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g,
      /\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g,
      // Month Day, Year (e.g., "jan 15, 2024", "december 1, 2024")
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      // Day Month Year (e.g., "15 jan 2024")
      /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/gi,
      // Month Year (e.g., "november 2025")
      new RegExp(`\\b(${this.monthPattern})\\s+\\d{4}\\b`, 'gi'),
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/gi,
      // Month Day without year (e.g., "december 1", "december 15", "jan 5")
      new RegExp(`\\b(${this.monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
      // Day Month without year (e.g., "1st december", "15 jan")
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
      new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(${this.monthPattern})\\b`, 'gi'),
    ];

    let cleaned = query;
    for (const pattern of datePatterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }
    
    // Clean up dangling connector words left after date removal
    cleaned = cleaned
      .replace(/\bbetween\s+and\b/gi, ' ')      // "between and" -> ""
      .replace(/\bfrom\s+to\b/gi, ' ')          // "from to" -> ""
      .replace(/\s+(and|to|from|for|between)\s*$/gi, ' ')  // trailing connectors
      .replace(/\s+/g, ' ')
      .trim();
    
    return cleaned;
  }

  /**
   * Extracts amount information from query using NER (compromise) and regex
   */
  private extractAmounts(query: string): { amountMin?: number; amountMax?: number } {
    const amounts: number[] = [];

    // Try NER first using compromise
    try {
      const doc = nlp(query);
      const money = doc.match('#Money');
      if (money.length > 0) {
        this.logger.debug(`[NER] Found ${money.length} money entities`);
        money.forEach((m: any) => {
          const text = m.text();
          this.logger.debug(`[NER] Money entity: "${text}"`);
          // Extract number from money text (e.g., "$100" -> 100, "₹404436.62" -> 404436.62)
          // Handle currency symbols by matching number anywhere in the string
          // Try multiple patterns to extract the number
          let numMatch = text.match(/([\d,]+\.?\d*)/);
          if (!numMatch) {
            // Try without commas
            numMatch = text.match(/(\d+\.?\d*)/);
          }
          if (numMatch) {
            const num = this.parseAmount(numMatch[1]);
            if (num > 0) {
              this.logger.debug(`[NER] Extracted amount: ${num}`);
              amounts.push(num);
            }
          } else {
            this.logger.debug(`[NER] Found money "${text}" but couldn't extract number`);
          }
        });
      } else {
        this.logger.debug(`[NER] No money entities in query: "${query}"`);
      }
    } catch (nerError) {
      this.logger.debug(`[NER] Money extraction failed, using regex: ${nerError}`);
    }

    // Run regex patterns to catch formats NER misses (like "Rs 5000")
    this.extractAmountsFromPatterns(query, amounts);

    if (amounts.length === 0) {
      return {};
    }

    // Remove duplicates and sort
    const uniqueAmounts = [...new Set(amounts)].sort((a, b) => a - b);

    // Check if it's a range pattern (use match instead of exec to avoid regex state issues)
    const rangePattern = /(?:between|from)\s+(\d+(?:[.,]\d+)?)\s+(?:and|to)\s+(\d+(?:[.,]\d+)?)/gi;
    const rangeMatch = query.match(rangePattern);
    if (rangeMatch) {
      return {
        amountMin: uniqueAmounts[0],
        amountMax: uniqueAmounts[uniqueAmounts.length - 1],
      };
    }

    // Single amount - use as approximate range (±10%)
    if (uniqueAmounts.length === 1) {
      const amount = uniqueAmounts[0];
      const tolerance = amount * 0.1;
      return {
        amountMin: Math.max(0, amount - tolerance),
        amountMax: amount + tolerance,
      };
    }

    // Multiple amounts - use as range
    return {
      amountMin: uniqueAmounts[0],
      amountMax: uniqueAmounts[uniqueAmounts.length - 1],
    };
  }

  /**
   * Parses amount string to number
   */
  private parseAmount(amountStr: string): number {
    const cleaned = amountStr.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Returns amount extraction regex patterns (fresh instances to avoid lastIndex issues)
   */
  private getAmountPatterns(): RegExp[] {
    return [
      /[₹$€£]\s*(\d+(?:[.,]\d+)?)/g,
      /(?:rupees?|rs\.?|dollars?|usd|eur|gbp)\s+(\d+(?:[.,]\d+)?)/gi,
      /(\d+(?:[.,]\d+)?)\s*(?:rupees?|rs\.?|dollars?|usd|eur|gbp)/gi,
      /(?:between|from)\s+(\d+(?:[.,]\d+)?)\s+(?:and|to)\s+(\d+(?:[.,]\d+)?)/gi,
      /(\d+(?:[.,]\d+)?)\s+to\s+(\d+(?:[.,]\d+)?)/gi,
      /\b(\d{4,}\.\d+)\b/g,
    ];
  }

  /**
   * Extracts amounts from query using regex patterns
   */
  private extractAmountsFromPatterns(query: string, amounts: number[]): void {
    for (const pattern of this.getAmountPatterns()) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        if (match[1]) {
          const amount = this.parseAmount(match[1]);
          if (amount > 0 && !amounts.includes(amount)) amounts.push(amount);
        }
        if (match[2]) {
          const amount = this.parseAmount(match[2]);
          if (amount > 0 && !amounts.includes(amount)) amounts.push(amount);
        }
      }
    }
  }

  /**
   * Removes amount-related text from query
   */
  private removeAmountText(query: string): string {
    const patterns = [
      /[₹$€£]\s*\d+(?:[.,]\d+)?/g,
      /(?:rupees?|rs\.?|dollars?|usd|eur|gbp)\s+\d+(?:[.,]\d+)?/gi,
      /\d+(?:[.,]\d+)?\s*(?:rupees?|rs\.?|dollars?|usd|eur|gbp)/gi,
      /(?:between|from)\s+\d+(?:[.,]\d+)?\s+(?:and|to)\s+\d+(?:[.,]\d+)?/gi,
      /\d+(?:[.,]\d+)?\s+to\s+\d+(?:[.,]\d+)?/gi,
      /\b(?:around|about|approximately|approx)\s+\d+(?:[.,]\d+)?/gi,
      /\b\d{4,}\.\d+\b/g,
    ];

    let cleaned = query;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned;
  }

  /**
   * Extracts vendor names (person names and organizations) using NER
   */
  private extractVendorNames(query: string): { vendorNames?: string[] } {
    try {
      const doc = nlp(query);
      const vendorNames: string[] = [];

      // Extract proper nouns (capitalized words) that might be vendor names
      // Look for patterns like "for [Name]", "from [Name]", "by [Name]"
      const afterPrepositions = doc.match('(for|from|by|vendor|supplier) #ProperNoun+');
      this.logger.debug(`[NER] Found ${afterPrepositions.length} proper nouns after prepositions`);
      if (afterPrepositions.length > 0) {
        afterPrepositions.forEach((match: any) => {
          const text = match.text().trim();
          this.logger.debug(`[NER] Preposition match: "${text}"`);
          // Remove the preposition
          const cleaned = text.replace(/\b(for|from|by|vendor|supplier)\s+/gi, '').trim();
          if (cleaned && cleaned.length > 0 && !vendorNames.includes(cleaned)) {
            this.logger.debug(`[NER] Extracted vendor from preposition: "${cleaned}"`);
            vendorNames.push(cleaned);
          }
        });
      }

      // Also check for standalone proper nouns (capitalized words)
      const properNouns = doc.match('#ProperNoun+');
      this.logger.debug(`[NER] Found ${properNouns.length} standalone proper nouns`);
      if (properNouns.length > 0) {
        properNouns.forEach((noun: any) => {
          const text = noun.text().trim();
          this.logger.debug(`[NER] Proper noun: "${text}"`);
          // Skip if it's already captured or is a stop word
          if (text && text.length > 1 && 
              !vendorNames.includes(text) &&
              !this.stopWords.has(text.toLowerCase())) {
            // Skip month names
            if (!this.monthNames.includes(text.toLowerCase())) {
              this.logger.debug(`[NER] Extracted vendor from proper noun: "${text}"`);
              vendorNames.push(text);
            } else {
              this.logger.debug(`[NER] Skipped "${text}" (month name)`);
            }
          } else {
            this.logger.debug(`[NER] Skipped "${text}" (already captured or stop word)`);
          }
        });
      }

      const result = vendorNames.length > 0 ? { vendorNames: [...new Set(vendorNames)] } : {};
      this.logger.debug(`[NER] Final vendor names: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.warn(`Error extracting vendor names from query: ${query}`, error);
      return {};
    }
  }

  /**
   * Extracts product names using context-aware NER
   * Only extracts products when they appear in specific patterns
   * Excludes vendor names, domain words, and other non-product terms
   */
  private extractProductNames(query: string, vendorNames: string[] = []): { productNames?: string[] } {
    try {
      const doc = nlp(query);
      const productNames: string[] = [];
      const vendorNamesLower = vendorNames.map(v => v.toLowerCase());

      // Helper to validate a potential product name (uses class-level exclusion sets)
      const isValidProduct = (text: string): boolean => {
        if (!text || text.length < 2) return false;
        
        const textLower = text.toLowerCase();
        if (vendorNamesLower.includes(textLower)) return false;
        if (this.domainWords.has(textLower)) return false;
        if (this.currencyWords.has(textLower)) return false;
        if (this.timeWords.has(textLower)) return false;
        if (this.stopWords.has(textLower)) return false;
        if (/\d/.test(text)) return false;
        if (this.containsStopWords(text)) return false;
        if (productNames.map(p => p.toLowerCase()).includes(textLower)) return false;
        
        return true;
      };

      // Strategy 1: Look for products after specific context keywords
      // These patterns indicate explicit product mentions
      const productPatterns = [
        '(with|containing|including|for) #Noun+',           // "invoices with laptops"
        '(product|products|item|items) #Noun+',             // "product electronics"
        '#Noun+ (product|products|item|items)',             // "laptop product"
        '(bought|purchased|ordered|sold) #Noun+',           // "bought laptops"
        '#Noun+ (invoice|invoices|bill|bills|order|orders)', // "laptop invoices" -> extract "laptop"
      ];

      for (const pattern of productPatterns) {
        const matches = doc.match(pattern);
        if (matches.length > 0) {
          matches.forEach((match: any) => {
            const text = match.text().trim();
            this.logger.debug(`[NER] Product pattern "${pattern}" matched: "${text}"`);
            
            // Extract just the noun part (remove trigger words)
            const cleaned = text
              .replace(/\b(with|containing|including|for|product|products|item|items|bought|purchased|ordered|sold|invoice|invoices|bill|bills|order|orders)\b/gi, '')
              .trim();
            
            if (cleaned && isValidProduct(cleaned)) {
              this.logger.debug(`[NER] Extracted product: "${cleaned}"`);
              productNames.push(cleaned);
            }
          });
        }
      }

      // Strategy 2: Look for quoted terms (user explicitly mentioned)
      // e.g., "find invoices for 'laptop'"
      const quotedPattern = /["']([^"']+)["']/g;
      let quotedMatch;
      while ((quotedMatch = quotedPattern.exec(query)) !== null) {
        const quoted = quotedMatch[1].trim();
        if (isValidProduct(quoted)) {
          this.logger.debug(`[NER] Extracted quoted product: "${quoted}"`);
          productNames.push(quoted);
        }
      }

      // Strategy 3: Look for capitalized multi-word terms (likely product names)
      // e.g., "MacBook Pro", "Office Supplies"
      const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
      let capMatch;
      while ((capMatch = capitalizedPattern.exec(query)) !== null) {
        const term = capMatch[1].trim();
        // Skip if it's already identified as a vendor
        if (isValidProduct(term) && !vendorNamesLower.includes(term.toLowerCase())) {
          this.logger.debug(`[NER] Extracted capitalized product: "${term}"`);
          productNames.push(term);
        }
      }

      // Strategy 4: Use NER to find specific product-like nouns
      // Only extract nouns that are tagged as objects/things, not abstract concepts
      const things = doc.match('#Noun').not('#Person').not('#Place').not('#Organization').not('#Date').not('#Money');
      if (things.length > 0) {
        things.forEach((noun: any) => {
          const text = noun.text().trim();
          const textLower = text.toLowerCase();
          
          // Only extract if it looks like a concrete product
          // Must be at least 3 chars and not a common word
          if (text.length >= 3 && isValidProduct(text)) {
            // Additional check: only extract if query context suggests it's a product
            const queryLower = query.toLowerCase();
            const hasProductContext = 
              queryLower.includes('with ' + textLower) ||
              queryLower.includes('for ' + textLower) ||
              queryLower.includes('containing ' + textLower) ||
              queryLower.includes(textLower + ' invoice') ||
              queryLower.includes(textLower + ' bill') ||
              queryLower.includes(textLower + ' order') ||
              queryLower.includes('bought ' + textLower) ||
              queryLower.includes('purchased ' + textLower);
            
            if (hasProductContext) {
              this.logger.debug(`[NER] Extracted contextual product: "${text}"`);
              productNames.push(text);
            }
          }
        });
      }

      // Deduplicate and return
      const uniqueProducts = [...new Set(productNames)];
      const result = uniqueProducts.length > 0 ? { productNames: uniqueProducts } : {};
      this.logger.debug(`[NER] Final product names: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.warn(`[NER] Error extracting product names: ${error}`);
      return {};
    }
  }

  /**
   * Escapes special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Checks if a phrase contains stop words
   */
  private containsStopWords(phrase: string): boolean {
    const words = phrase.toLowerCase().split(/\s+/);
    return words.some(word => {
      const cleaned = word.replace(/[.,!?;:]/g, '');
      return this.stopWords.has(cleaned);
    });
  }

  /**
   * Removes stop words from query
   */
  private removeStopWords(query: string): string {
    // Split into words, filter out stop words, and rejoin
    const words = query
      .split(/\s+/)
      .filter((word) => {
        const cleaned = word.toLowerCase().replace(/[.,!?;:]/g, '');
        return cleaned.length > 0 && !this.stopWords.has(cleaned);
      });

    return words.join(' ');
  }

  /**
   * Formats date to YYYY-MM-DD string
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

