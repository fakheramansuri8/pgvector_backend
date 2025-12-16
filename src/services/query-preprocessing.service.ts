import { Injectable, Logger } from '@nestjs/common';
import * as chrono from 'chrono-node';

export interface PreprocessedQuery {
  normalizedQuery: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
}

@Injectable()
export class QueryPreprocessingService {
  private readonly logger = new Logger(QueryPreprocessingService.name);

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

    const originalQuery = query.trim().toLowerCase();
    let workingQuery = originalQuery;
    this.logger.log(`[PREPROCESS] Lowercase query: "${workingQuery}"`);

    // 1. Extract dates
    const dateInfo = this.extractDates(workingQuery);
    this.logger.log(`[PREPROCESS] Date extraction result:`, JSON.stringify(dateInfo));
    
    if (dateInfo.dateFrom || dateInfo.dateTo) {
      // Remove date-related text from query
      const beforeDateRemoval = workingQuery;
      workingQuery = this.removeDateText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After date removal: "${beforeDateRemoval}" -> "${workingQuery}"`);
    }

    // 2. Extract amounts
    const amountInfo = this.extractAmounts(workingQuery);
    this.logger.log(`[PREPROCESS] Amount extraction result:`, JSON.stringify(amountInfo));
    
    if (amountInfo.amountMin !== undefined || amountInfo.amountMax !== undefined) {
      // Remove amount-related text from query
      const beforeAmountRemoval = workingQuery;
      workingQuery = this.removeAmountText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After amount removal: "${beforeAmountRemoval}" -> "${workingQuery}"`);
    }

    // 3. Extract vendor names and product names (keep these in query)
    // Vendor names are typically after "for", "from", "by", "vendor", "supplier"
    // Product names are typically after "product", "item", "with"

    // 4. Remove stop words
    const beforeStopWordRemoval = workingQuery;
    const normalizedQuery = this.removeStopWords(workingQuery);
    this.logger.log(`[PREPROCESS] After stop word removal: "${beforeStopWordRemoval}" -> "${normalizedQuery}"`);
    
    const finalNormalized = normalizedQuery.trim();
    this.logger.log(`[PREPROCESS] Final normalized query: "${finalNormalized}"`);
    this.logger.log(`[PREPROCESS] Final result:`, JSON.stringify({
      normalizedQuery: finalNormalized,
      ...dateInfo,
      ...amountInfo,
    }));

    return {
      normalizedQuery: finalNormalized,
      ...dateInfo,
      ...amountInfo,
    };
  }

  /**
   * Extracts date information from query using chrono-node
   */
  private extractDates(query: string): { dateFrom?: string; dateTo?: string } {
    try {
      const now = new Date();
      const queryLower = query.toLowerCase();

      // Handle "last [month]" pattern explicitly (e.g., "last april", "last month")
      const lastMonthMatch = queryLower.match(/\blast\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
      if (lastMonthMatch) {
        const monthName = lastMonthMatch[1];
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

        return {
          dateFrom: this.formatDate(firstDay),
          dateTo: this.formatDate(lastDay),
        };
      }

      // Handle "last month" (previous calendar month)
      if (/\blast\s+month\b/.test(queryLower)) {
        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        return {
          dateFrom: this.formatDate(firstDayLastMonth),
          dateTo: this.formatDate(lastDayLastMonth),
        };
      }

      // Handle "last week" (previous 7 days from today, or previous Monday-Sunday)
      if (/\blast\s+week\b/.test(queryLower)) {
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

        return {
          dateFrom: this.formatDate(lastMonday),
          dateTo: this.formatDate(lastSunday),
        };
      }

      // Parse dates from the query with current date as reference
      const parsedDates = chrono.parse(query, now);

      if (parsedDates.length === 0) {
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
        return { dateFrom: dateStr, dateTo: dateStr };
      }

      // Multiple dates - use as range
      const dateFrom = this.formatDate(dates[0]);
      const dateTo = this.formatDate(dates[dates.length - 1]);
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
    const months: Record<string, number> = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };
    return months[monthName.toLowerCase()] ?? 0;
  }

  /**
   * Removes date-related text from query
   */
  private removeDateText(query: string): string {
    // Remove common date patterns
    const datePatterns = [
      /\b(today|yesterday|tomorrow)\b/gi,
      /\b(last|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
      /\b(this|that)\s+(day|week|month|year)\b/gi,
      /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, // MM/DD/YYYY or DD/MM/YYYY
      /\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g, // YYYY-MM-DD
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/gi,
    ];

    let cleaned = query;
    for (const pattern of datePatterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    return cleaned;
  }

  /**
   * Extracts amount information from query
   */
  private extractAmounts(query: string): { amountMin?: number; amountMax?: number } {
    // Patterns for amounts:
    // - Numbers with currency symbols (₹, $, Rs, rupees, etc.)
    // - Numbers followed by "rupees", "rs", "dollars", etc.
    // - Ranges like "5000 to 10000", "between 5000 and 10000"
    // - Approximations like "around 5000", "about 5000"

    const amountPatterns = [
      // Currency symbols
      /[₹$€£]\s*(\d+(?:[.,]\d+)?)/g,
      // Numbers with currency words
      /(\d+(?:[.,]\d+)?)\s*(?:rupees?|rs\.?|dollars?|usd|eur|gbp)/gi,
      // Standalone large numbers (likely amounts)
      /\b(\d{4,}(?:[.,]\d+)?)\b/g,
      // Ranges
      /(?:between|from)\s+(\d+(?:[.,]\d+)?)\s+(?:and|to)\s+(\d+(?:[.,]\d+)?)/gi,
      /(\d+(?:[.,]\d+)?)\s+to\s+(\d+(?:[.,]\d+)?)/gi,
    ];

    const amounts: number[] = [];

    for (const pattern of amountPatterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        if (match[1]) {
          const amount = this.parseAmount(match[1]);
          if (amount > 0) {
            amounts.push(amount);
          }
        }
        if (match[2]) {
          const amount = this.parseAmount(match[2]);
          if (amount > 0) {
            amounts.push(amount);
          }
        }
      }
    }

    if (amounts.length === 0) {
      return {};
    }

    // Remove duplicates and sort
    const uniqueAmounts = [...new Set(amounts)].sort((a, b) => a - b);

    // Check if it's a range pattern
    const rangePattern = /(?:between|from)\s+(\d+(?:[.,]\d+)?)\s+(?:and|to)\s+(\d+(?:[.,]\d+)?)/gi;
    const rangeMatch = rangePattern.exec(query);
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
    // Remove commas and convert to number
    const cleaned = amountStr.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Removes amount-related text from query
   */
  private removeAmountText(query: string): string {
    const amountPatterns = [
      /[₹$€£]\s*\d+(?:[.,]\d+)?/g,
      /\d+(?:[.,]\d+)?\s*(?:rupees?|rs\.?|dollars?|usd|eur|gbp)/gi,
      /(?:between|from)\s+\d+(?:[.,]\d+)?\s+(?:and|to)\s+\d+(?:[.,]\d+)?/gi,
      /\d+(?:[.,]\d+)?\s+to\s+\d+(?:[.,]\d+)?/gi,
      /\b(?:around|about|approximately|approx)\s+\d+(?:[.,]\d+)?/gi,
    ];

    let cleaned = query;
    for (const pattern of amountPatterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    return cleaned;
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

