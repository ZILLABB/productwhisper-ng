import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

export class KongaScraper extends BaseScraper {
  constructor() {
    super('KONGA', PLATFORM_BASE_URLS.KONGA);
  }

  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];
    const maxPages = options.maxPages ?? 3;
    const maxResults = options.maxResults ?? 50;

    for (let page = 1; page <= maxPages && products.length < maxResults; page++) {
      try {
        const searchUrl = `/search?search=${encodeURIComponent(options.query)}${page > 1 ? `&page=${page}` : ''}`;
        const $ = await this.fetchHtml(searchUrl);

        $('section.product-card, div[data-testid="product-card"], li.sku').each((_, el) => {
          if (products.length >= maxResults) return;

          const $el = $(el);
          const link = $el.find('a').first().attr('href') ?? '';
          const title = this.cleanText(
            $el.find('.product-card__name, .product-name, h3').first().text()
          );
          const priceText = $el.find('.product-card__price, .current-price, .price').first().text();
          const price = this.cleanPrice(priceText);
          const imageUrl = $el.find('img').first().attr('src') ?? $el.find('img').first().attr('data-src') ?? '';
          const vendorName = this.cleanText($el.find('.product-card__seller, .seller-name').text());

          if (title && price > 0) {
            products.push({
              externalId: this.extractProductId(link),
              platform: 'KONGA',
              title,
              price,
              currency: 'NGN',
              condition: classifyCondition(title),
              url: link.startsWith('http') ? link : `${PLATFORM_BASE_URLS.KONGA}${link}`,
              imageUrl: imageUrl || undefined,
              vendor: vendorName ? { externalId: '', name: vendorName } : undefined,
              metadata: { page },
            });
          }
        });
      } catch (err) {
        console.error(`Konga search page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return products;
  }

  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const $ = await this.fetchHtml(url);

      const title = this.cleanText($('h1.product-name, h1').first().text());
      const priceText = $('span.current-price, span.price').first().text();
      const price = this.cleanPrice(priceText);
      const imageUrl = $('img.product-image, img.main-image').first().attr('src') ?? '';
      const description = this.cleanText($('div.product-description, div.description').first().text());
      const vendorName = this.cleanText($('a.seller-name, span.seller-name').first().text());
      const brand = this.cleanText($('span.brand, a[href*="brand"]').first().text());

      if (!title || price <= 0) return null;

      return {
        externalId: this.extractProductId(url),
        platform: 'KONGA',
        title,
        price,
        currency: 'NGN',
        condition: classifyCondition(title),
        url,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        vendor: vendorName ? { externalId: '', name: vendorName } : undefined,
        metadata: { brand: brand || undefined },
      };
    } catch (err) {
      console.error('Konga product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getProductReviews(productUrl: string, maxPages = 3): Promise<ScrapedReview[]> {
    const reviews: ScrapedReview[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const $ = await this.fetchHtml(productUrl);

        $('div.review-item, article.review').each((_, el) => {
          const $el = $(el);
          const author = this.cleanText($el.find('.reviewer-name, .review-author').text());
          const content = this.cleanText($el.find('.review-text, .review-body, p').first().text());
          const title = this.cleanText($el.find('.review-title, h4').text());
          const ratingText = $el.find('.star-rating, [data-rating]').attr('data-rating') ?? '';
          const dateText = this.cleanText($el.find('.review-date, time').text());

          if (content && content.length > 5) {
            reviews.push({
              externalId: `konga-review-${reviews.length}-${Date.now()}`,
              author: author || undefined,
              rating: parseInt(ratingText) || undefined,
              title: title || undefined,
              content,
              postedAt: dateText || undefined,
            });
          }
        });

        break; // Konga typically loads reviews dynamically, one page is what we get from HTML
      } catch (err) {
        console.error(`Konga reviews page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return reviews;
  }

  private extractProductId(urlOrPath: string): string {
    const match = urlOrPath.match(/\/product\/([^/?]+)/) || urlOrPath.match(/\/([^/]+)$/);
    return match ? match[1] : `konga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
