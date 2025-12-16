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
    console.log('🔵 [NER] Dates extracted:', JSON.stringify(dateInfo, null, 2));
    this.logger.log(`[PREPROCESS] Date extraction result:`, JSON.stringify(dateInfo));
    
    if (dateInfo.dateFrom || dateInfo.dateTo) {
      // Remove date-related text from query
      const beforeDateRemoval = workingQuery;
      workingQuery = this.removeDateText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After date removal: "${beforeDateRemoval}" -> "${workingQuery}"`);
    }

    // 2. Extract amounts
    const amountInfo = this.extractAmounts(workingQuery);
    console.log('🟢 [NER] Amounts extracted:', JSON.stringify(amountInfo, null, 2));
    this.logger.log(`[PREPROCESS] Amount extraction result:`, JSON.stringify(amountInfo));
    
    if (amountInfo.amountMin !== undefined || amountInfo.amountMax !== undefined) {
      // Remove amount-related text from query
      const beforeAmountRemoval = workingQuery;
      workingQuery = this.removeAmountText(workingQuery).trim();
      this.logger.log(`[PREPROCESS] After amount removal: "${beforeAmountRemoval}" -> "${workingQuery}"`);
    }

    // 3. Extract vendor names and product names using NER
    const vendorInfo = this.extractVendorNames(workingQuery);
    
    // Extract product names AFTER vendor extraction, and exclude vendor names from products
    const productInfo = this.extractProductNames(workingQuery, vendorInfo.vendorNames || []);
    
    console.log('🟡 [NER] Vendor names extracted:', JSON.stringify(vendorInfo, null, 2));
    console.log('🟠 [NER] Product names extracted:', JSON.stringify(productInfo, null, 2));
    
    // IMPORTANT: Keep vendor names and product names in query for embedding generation
    // They will be used for semantic search, so they must remain in the normalized query
    console.log(`  ✅ [NER] Keeping vendor/product names in query for embedding: "${workingQuery}"`);

    // 4. Remove stop words (vendor/product names will remain after this)
    const beforeStopWordRemoval = workingQuery;
    const normalizedQuery = this.removeStopWords(workingQuery);
    this.logger.log(`[PREPROCESS] After stop word removal: "${beforeStopWordRemoval}" -> "${normalizedQuery}"`);
    
    const finalNormalized = normalizedQuery.trim();
    console.log(`  ✅ [NER] Final normalized query for embedding: "${finalNormalized}"`);
    this.logger.log(`[PREPROCESS] Final normalized query: "${finalNormalized}"`);
    
    const finalResult = {
      normalizedQuery: finalNormalized,
      ...dateInfo,
      ...amountInfo,
      vendorNames: vendorInfo.vendorNames,
      productNames: productInfo.productNames,
    };
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 [NER] COMPLETE EXTRACTION SUMMARY:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(JSON.stringify(finalResult, null, 2));
    console.log('═══════════════════════════════════════════════════════════');
    
    this.logger.log(`[PREPROCESS] Final result:`, JSON.stringify(finalResult));

    return {
      normalizedQuery: finalNormalized,
      ...dateInfo,
      ...amountInfo,
      vendorNames: vendorInfo.vendorNames,
      productNames: productInfo.productNames,
    };
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
          // Compromise handles relative dates well, but for absolute dates we use chrono-node
          // So we'll primarily use chrono-node for dates, compromise is better for other entities
        }
      } catch (nerError) {
        this.logger.debug(`NER date extraction failed, falling back to chrono-node: ${nerError}`);
      }

      // Handle "last [month]" pattern explicitly (e.g., "last april", "last month")
      const lastMonthMatch = queryLower.match(/\blast\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
      if (lastMonthMatch) {
        const monthName = lastMonthMatch[1];
        console.log(`  📅 [NER] Found "last ${monthName}" pattern`);
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
        console.log(`  📅 [NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Handle "last month" (previous calendar month)
      if (/\blast\s+month\b/.test(queryLower)) {
        console.log(`  📅 [NER] Found "last month" pattern`);
        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        const result = {
          dateFrom: this.formatDate(firstDayLastMonth),
          dateTo: this.formatDate(lastDayLastMonth),
        };
        console.log(`  📅 [NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Handle "last week" (previous 7 days from today, or previous Monday-Sunday)
      if (/\blast\s+week\b/.test(queryLower)) {
        console.log(`  📅 [NER] Found "last week" pattern`);
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
        console.log(`  📅 [NER] Extracted date range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Check for month + year pattern (e.g., "november 2025", "december 2024")
      const monthYearMatch = queryLower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/);
      if (monthYearMatch) {
        const monthName = monthYearMatch[1];
        const year = parseInt(monthYearMatch[2], 10);
        const monthIndex = this.getMonthIndex(monthName);
        
        console.log(`  📅 [NER] Found month+year pattern: "${monthName} ${year}"`);
        
        // Get first and last day of that month
        const firstDay = new Date(year, monthIndex, 1);
        const lastDay = new Date(year, monthIndex + 1, 0); // Last day of month
        
        const result = {
          dateFrom: this.formatDate(firstDay),
          dateTo: this.formatDate(lastDay),
        };
        console.log(`  📅 [NER] Extracted month range: ${result.dateFrom} to ${result.dateTo}`);
        return result;
      }

      // Parse dates from the query with current date as reference
      console.log(`  📅 [NER] Using chrono-node to parse dates from: "${query}"`);
      const parsedDates = chrono.parse(query, now);
      console.log(`  📅 [NER] Chrono-node found ${parsedDates.length} date matches`);

      if (parsedDates.length === 0) {
        console.log(`  📅 [NER] No dates extracted`);
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
        console.log(`  📅 [NER] Extracted single date: ${dateStr}`);
        return { dateFrom: dateStr, dateTo: dateStr };
      }

      // Multiple dates - use as range
      const dateFrom = this.formatDate(dates[0]);
      const dateTo = this.formatDate(dates[dates.length - 1]);
      console.log(`  📅 [NER] Extracted date range: ${dateFrom} to ${dateTo}`);
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
      // Month + Year patterns (e.g., "november 2025", "december 2024")
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/gi,
    ];

    let cleaned = query;
    for (const pattern of datePatterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }

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
        money.forEach((m: any) => {
          const text = m.text();
          // Extract number from money text (e.g., "$100" -> 100, "₹404436.62" -> 404436.62)
          const numMatch = text.match(/[\d,]+\.?\d*/);
          if (numMatch) {
            const num = this.parseAmount(numMatch[0]);
            if (num > 0) {
              amounts.push(num);
            }
          }
        });
      }
    } catch (nerError) {
      this.logger.debug(`NER money extraction failed, falling back to regex: ${nerError}`);
    }

    // Fallback to regex patterns if NER didn't find anything
    if (amounts.length === 0) {
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
   * Extracts vendor names (person names and organizations) using NER
   */
  private extractVendorNames(query: string): { vendorNames?: string[] } {
    try {
      const doc = nlp(query);
      const vendorNames: string[] = [];

      // Extract proper nouns (capitalized words) that might be vendor names
      // Look for patterns like "for [Name]", "from [Name]", "by [Name]"
      const afterPrepositions = doc.match('(for|from|by|vendor|supplier) #ProperNoun+');
      if (afterPrepositions.length > 0) {
        afterPrepositions.forEach((match: any) => {
          const text = match.text().trim();
          // Remove the preposition
          const cleaned = text.replace(/\b(for|from|by|vendor|supplier)\s+/gi, '').trim();
          if (cleaned && cleaned.length > 0 && !vendorNames.includes(cleaned)) {
            vendorNames.push(cleaned);
          }
        });
      }

      // Also check for standalone proper nouns (capitalized words)
      const properNouns = doc.match('#ProperNoun+');
      if (properNouns.length > 0) {
        properNouns.forEach((noun: any) => {
          const text = noun.text().trim();
          // Skip if it's already captured or is a stop word
          if (text && text.length > 1 && 
              !vendorNames.includes(text) &&
              !this.stopWords.has(text.toLowerCase())) {
            // Check if it looks like a name (not a single letter, not a common word)
            // Skip month names and common words
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                              'july', 'august', 'september', 'october', 'november', 'december'];
            if (!monthNames.includes(text.toLowerCase())) {
              vendorNames.push(text);
            }
          }
        });
      }

      return vendorNames.length > 0 ? { vendorNames: [...new Set(vendorNames)] } : {};
    } catch (error) {
      this.logger.warn(`Error extracting vendor names from query: ${query}`, error);
      return {};
    }
  }

  /**
   * Extracts product names using NER and context
   * Excludes vendor names to avoid confusion
   */
  private extractProductNames(query: string, vendorNames: string[] = []): { productNames?: string[] } {
    try {
      const doc = nlp(query);
      const productNames: string[] = [];
      const vendorNamesLower = vendorNames.map(v => v.toLowerCase());

      // Look for nouns that might be products (after "with", "product", "item")
      const withProducts = doc.match('(with|product|item) #Noun+');
      console.log(`  📦 [NER] Found ${withProducts.length} product matches after keywords`);
      if (withProducts.length > 0) {
        withProducts.forEach((match: any) => {
          const text = match.text().trim();
          console.log(`  📦 [NER] Product match: "${text}"`);
          // Remove the trigger word
          const cleaned = text.replace(/\b(with|product|item)\s+/gi, '').trim();
          if (cleaned && cleaned.length > 0) {
            // Skip if it's a vendor name
            if (!vendorNamesLower.includes(cleaned.toLowerCase())) {
              console.log(`  📦 [NER] Extracted product name: "${cleaned}"`);
              productNames.push(cleaned);
            } else {
              console.log(`  📦 [NER] Skipped "${cleaned}" (it's a vendor name)`);
            }
          }
        });
      }

      // Extract common nouns that might be products (but exclude vendor names)
      const nouns = doc.nouns();
      console.log(`  📦 [NER] Found ${nouns.length} nouns`);
      if (nouns.length > 0) {
        nouns.forEach((noun: any) => {
          const text = noun.text().trim();
          console.log(`  📦 [NER] Noun: "${text}"`);
          // Skip if it's a stop word, vendor name, or already captured
          if (text && text.length > 0 && 
              !this.stopWords.has(text.toLowerCase()) &&
              !vendorNamesLower.includes(text.toLowerCase()) &&
              !productNames.includes(text)) {
            console.log(`  📦 [NER] Extracted product name from noun: "${text}"`);
            productNames.push(text);
          } else {
            if (vendorNamesLower.includes(text.toLowerCase())) {
              console.log(`  📦 [NER] Skipped "${text}" (it's a vendor name)`);
            } else {
              console.log(`  📦 [NER] Skipped "${text}" (stop word or duplicate)`);
            }
          }
        });
      }

      const result = productNames.length > 0 ? { productNames: [...new Set(productNames)] } : {};
      console.log(`  📦 [NER] Final product names: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      console.log(`  ⚠️ [NER] Error extracting product names: ${error}`);
      this.logger.warn(`Error extracting product names from query: ${query}`, error);
      return {};
    }
  }

  /**
   * Removes vendor names from query
   */
  private removeVendorNames(query: string, vendorNames: string[]): string {
    let cleaned = query;
    for (const vendorName of vendorNames) {
      // Create regex to match the vendor name (case insensitive, word boundaries)
      const pattern = new RegExp(`\\b${vendorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned.trim();
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

