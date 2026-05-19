import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedProduct, ScrapedReview } from '@/shared/types';
import { randomUserAgent, delay, randomDelay, retry } from '@/shared/utils';
import { scraperConfig } from '@/config';
import { ScraperError } from '@/shared/errors';

export interface ScraperSearchOptions {
  query: string;
  category?: string;
  maxPages?: number;
  maxResults?: number;
}

export abstract class BaseScraper {
  protected client: AxiosInstance;
  protected platform: string;

  constructor(platform: string, baseURL: string) {
    this.platform = platform;
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-NG,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
  }

  abstract searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]>;
  abstract getProductDetails(url: string): Promise<ScrapedProduct | null>;
  abstract getProductReviews(productUrl: string, maxPages?: number): Promise<ScrapedReview[]>;

  protected async fetchHtml(url: string, config?: AxiosRequestConfig): Promise<cheerio.CheerioAPI> {
    return retry(async () => {
      this.client.defaults.headers['User-Agent'] = randomUserAgent();
      await randomDelay(scraperConfig.delayMs, scraperConfig.delayMs * 2);

      const response = await this.client.get(url, {
        ...config,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403 || response.status === 429) {
        throw new ScraperError(this.platform, `Rate limited (${response.status})`);
      }

      if (response.status === 404) {
        throw new ScraperError(this.platform, 'Page not found');
      }

      return cheerio.load(response.data);
    }, 3, scraperConfig.delayMs * 2);
  }

  protected async fetchJson<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return retry(async () => {
      this.client.defaults.headers['User-Agent'] = randomUserAgent();
      await randomDelay(scraperConfig.delayMs, scraperConfig.delayMs * 2);

      const response = await this.client.get<T>(url, {
        ...config,
        headers: { ...config?.headers, 'Accept': 'application/json' },
      });

      return response.data;
    }, 3, scraperConfig.delayMs * 2);
  }

  protected cleanText(text: string | undefined | null): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  protected cleanPrice(text: string | undefined | null): number {
    if (!text) return 0;
    const cleaned = text.replace(/[₦,\s]/g, '').replace(/naira/gi, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
}
