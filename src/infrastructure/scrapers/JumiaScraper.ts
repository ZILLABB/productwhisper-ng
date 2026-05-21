import * as cheerio from 'cheerio';
import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

export class JumiaScraper extends BaseScraper {
  constructor() {
    super('JUMIA', PLATFORM_BASE_URLS.JUMIA);
  }

  /**
   * Search Jumia catalog. Uses CSS selectors on the search results page.
   */
  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];
    const maxPages = options.maxPages ?? 3;
    const maxResults = options.maxResults ?? 50;

    for (let page = 1; page <= maxPages && products.length < maxResults; page++) {
      try {
        const searchUrl = `/catalog/?q=${encodeURIComponent(options.query)}${page > 1 ? `&page=${page}` : ''}`;
        const $ = await this.fetchHtml(searchUrl);

        $('article.prd._fb.col.c-prd').each((_, el) => {
          if (products.length >= maxResults) return;

          const $el = $(el);
          const link = $el.find('a.core').attr('href') ?? '';
          const title = this.cleanText($el.find('.name').text());
          const priceText = $el.find('.prc').text();
          const price = this.cleanPrice(priceText);
          const imageUrl = $el.find('img.img').attr('data-src') ?? $el.find('img.img').attr('src') ?? '';
          const externalId = this.extractProductId(link);
          const ratingText = $el.find('.stars._s').attr('style') ?? '';
          const vendorName = this.cleanText($el.find('.bdg._mall').text());

          if (title && price > 0) {
            products.push({
              externalId,
              platform: 'JUMIA',
              title,
              price,
              currency: 'NGN',
              condition: classifyCondition(title),
              url: link.startsWith('http') ? link : `${PLATFORM_BASE_URLS.JUMIA}${link}`,
              imageUrl: imageUrl || undefined,
              vendor: vendorName ? { externalId: '', name: vendorName, isVerified: vendorName.toLowerCase().includes('jumia') || vendorName.toLowerCase().includes('official') } : undefined,
              metadata: { page, ratingStyle: ratingText },
            });
          }
        });
      } catch (err) {
        console.error(`Jumia search page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return products;
  }

  /**
   * Get full product details using JSON-LD structured data (primary)
   * with CSS selector fallback. JSON-LD is much more reliable than
   * CSS selectors since Jumia embeds full product data in it.
   */
  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const $ = await this.fetchHtml(url);

      // ── Try JSON-LD first (most reliable) ──
      const jsonLd = this.extractJsonLd($);
      if (jsonLd) {
        return this.parseJsonLdProduct(jsonLd, url);
      }

      // ── Fallback to CSS selectors ──
      const title = this.cleanText($('h1').first().text());
      const priceText = $('span[data-price="true"]').text() || $('span.-b.-ubpt.-tal.-fs24').text();
      const price = this.cleanPrice(priceText);
      const imageUrl = $('img#img-main').attr('data-src') ?? $('img.swiper-lazy').first().attr('data-src') ?? '';
      const description = this.cleanText($('div.markup.-pam').text());
      const brand = this.cleanText($('a[href*="brand"]').text()) || this.cleanText($('Brand a').text());

      if (!title || price <= 0) return null;

      return {
        externalId: this.extractProductId(url),
        platform: 'JUMIA',
        title,
        price,
        currency: 'NGN',
        condition: classifyCondition(title),
        url,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        metadata: { brand: brand || undefined },
      };
    } catch (err) {
      console.error('Jumia product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Get product reviews. Extracts from JSON-LD first (embedded in product page),
   * then also scrapes the HTML review section for any additional reviews.
   */
  async getProductReviews(productUrl: string, maxPages = 3): Promise<ScrapedReview[]> {
    const reviews: ScrapedReview[] = [];
    const seenContent = new Set<string>();

    try {
      // ── Phase 1: JSON-LD reviews (always on product page) ──
      const $ = await this.fetchHtml(productUrl);
      const jsonLd = this.extractJsonLd($);

      if (jsonLd?.review && Array.isArray(jsonLd.review)) {
        for (const r of jsonLd.review) {
          const content = this.cleanText(r.reviewBody || '');
          if (content.length > 3 && !seenContent.has(content)) {
            seenContent.add(content);
            reviews.push({
              externalId: `jumia-jld-${reviews.length}-${Date.now()}`,
              author: this.cleanText((r.author?.name || '').replace(/^by\s+/i, '')),
              rating: r.reviewRating?.ratingValue ? Number(r.reviewRating.ratingValue) : undefined,
              title: this.cleanText(r.name || ''),
              content,
              postedAt: r.datePublished || undefined,
            });
          }
        }
      }

      // ── Phase 2: HTML review scraping for additional reviews ──
      for (let page = 1; page <= maxPages; page++) {
        try {
          const reviewUrl = page === 1 ? productUrl : `${productUrl}${productUrl.includes('?') ? '&' : '?'}page=${page}#reviews`;
          const $page = page === 1 ? $ : await this.fetchHtml(reviewUrl);

          $page('article.rvw-item, div[data-testid="review"]').each((_, el) => {
            const $el = $page(el);
            const author = this.cleanText($el.find('.rvw-athr, .author').text());
            const content = this.cleanText($el.find('.rvw-bd, .review-body, p').first().text());
            const title = this.cleanText($el.find('.rvw-ttl, .review-title').text());
            const ratingStars = $el.find('.stars._s ._y, .star-rating [data-star]').length || 0;
            const dateText = this.cleanText($el.find('.rvw-date, time').text());

            if (content && content.length > 3 && !seenContent.has(content)) {
              seenContent.add(content);
              reviews.push({
                externalId: `jumia-html-${reviews.length}-${Date.now()}`,
                author: author ? author.replace(/^by\s+/i, '') : undefined,
                rating: ratingStars > 0 ? ratingStars : undefined,
                title: title || undefined,
                content,
                postedAt: dateText || undefined,
              });
            }
          });

          const hasNextPage = $page('a[aria-label="Next"]').length > 0;
          if (!hasNextPage) break;
        } catch {
          break;
        }
      }
    } catch (err) {
      console.error('Jumia reviews failed:', err instanceof Error ? err.message : err);
    }

    return reviews;
  }

  // ─── JSON-LD Parsing ─────────────────────────────────

  /**
   * Extract the JSON-LD Product data from the page.
   * Jumia puts rich structured data including brand, price, seller,
   * images, description, and reviews in JSON-LD @graph format.
   */
  private extractJsonLd($: ReturnType<typeof cheerio.load>): any | null {
    try {
      let productData: any = null;

      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const raw = $(el).html();
          if (!raw) return;
          const parsed = JSON.parse(raw);

          // Handle @graph format (Jumia's format)
          if (parsed['@graph']) {
            const product = parsed['@graph'].find((item: any) => item['@type'] === 'Product');
            if (product) productData = product;
          }
          // Handle direct Product type
          else if (parsed['@type'] === 'Product') {
            productData = parsed;
          }
        } catch {
          // Invalid JSON in script tag, skip
        }
      });

      return productData;
    } catch {
      return null;
    }
  }

  /**
   * Parse a JSON-LD Product object into our ScrapedProduct format.
   */
  private parseJsonLdProduct(jsonLd: any, url: string): ScrapedProduct | null {
    try {
      const title = jsonLd.name || '';
      const brand = jsonLd.brand?.name || '';
      const description = jsonLd.description || '';
      const sku = jsonLd.sku || '';
      const category = jsonLd.category || '';

      // Price from offers
      const price = jsonLd.offers?.price ? Number(jsonLd.offers.price) : 0;
      const currency = jsonLd.offers?.priceCurrency || 'NGN';

      // Images — JSON-LD has high-res images
      let imageUrl: string | undefined;
      if (jsonLd.image?.contentUrl) {
        const urls = Array.isArray(jsonLd.image.contentUrl) ? jsonLd.image.contentUrl : [jsonLd.image.contentUrl];
        imageUrl = urls[0]; // First image is the main one
      }

      // Vendor from offers.seller
      let vendor: ScrapedVendor | undefined;
      const seller = jsonLd.offers?.seller;
      if (seller) {
        vendor = {
          externalId: seller['@id'] || '',
          name: seller.name || '',
          profileUrl: seller.url ? (seller.url.startsWith('http') ? seller.url : `${PLATFORM_BASE_URLS.JUMIA}${seller.url}`) : undefined,
          isVerified: (seller.name || '').toLowerCase().includes('jumia') || (seller.name || '').toLowerCase().includes('official'),
        };
      }

      // Rating info
      const rating = jsonLd.aggregateRating?.ratingValue ? Number(jsonLd.aggregateRating.ratingValue) : undefined;
      const reviewCount = jsonLd.aggregateRating?.reviewCount ? Number(jsonLd.aggregateRating.reviewCount) : undefined;

      if (!title || price <= 0) return null;

      // Extract reviews from JSON-LD too (stored in metadata for the ingestion pipeline)
      const reviews: ScrapedReview[] = [];
      if (jsonLd.review && Array.isArray(jsonLd.review)) {
        for (const r of jsonLd.review) {
          const content = (r.reviewBody || '').trim();
          if (content.length > 3) {
            reviews.push({
              externalId: `jumia-jld-${reviews.length}-${Date.now()}`,
              author: (r.author?.name || '').replace(/^by\s+/i, '').trim() || undefined,
              rating: r.reviewRating?.ratingValue ? Number(r.reviewRating.ratingValue) : undefined,
              title: (r.name || '').trim() || undefined,
              content,
              postedAt: r.datePublished || undefined,
            });
          }
        }
      }

      return {
        externalId: sku || this.extractProductId(url),
        platform: 'JUMIA',
        title,
        price,
        currency,
        condition: classifyCondition(title),
        url,
        imageUrl,
        description: description || undefined,
        vendor,
        reviews: reviews.length > 0 ? reviews : undefined,
        metadata: {
          brand: brand || undefined,
          category: category || undefined,
          rating,
          reviewCount,
          sku,
          source: 'json-ld',
        },
      };
    } catch (err) {
      console.error('JSON-LD parse failed:', err);
      return null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────

  private extractProductId(urlOrPath: string): string {
    const match = urlOrPath.match(/-(\d+)\.html/) || urlOrPath.match(/\/([^/]+)\.html/);
    return match ? match[1] : `jumia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private extractVendorId(urlOrPath: string): string {
    const match = urlOrPath.match(/seller\/([^/?]+)/);
    return match ? match[1] : '';
  }
}
