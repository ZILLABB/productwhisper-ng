import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

export class JijiScraper extends BaseScraper {
  constructor() {
    super('JIJI', PLATFORM_BASE_URLS.JIJI);
  }

  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];
    const maxPages = options.maxPages ?? 3;
    const maxResults = options.maxResults ?? 50;

    for (let page = 1; page <= maxPages && products.length < maxResults; page++) {
      try {
        const searchUrl = `/search?query=${encodeURIComponent(options.query)}${page > 1 ? `&page=${page}` : ''}`;
        const $ = await this.fetchHtml(searchUrl);

        $('div[data-advid], li.masonry-item, div.b-list-advert__gallery__item').each((_, el) => {
          if (products.length >= maxResults) return;

          const $el = $(el);
          const link = $el.find('a').first().attr('href') ?? '';
          const title = this.cleanText(
            $el.find('.b-advert-title-inner, .qa-advert-title, h3').first().text()
          );
          const priceText = $el.find('.qa-advert-price, .b-list-advert__aside__price, .advert-price').first().text();
          const price = this.cleanPrice(priceText);
          const imageUrl = $el.find('img').first().attr('src') ?? $el.find('img').first().attr('data-src') ?? '';
          const location = this.cleanText($el.find('.b-advert-info-region, .advert-location').text());
          const vendorName = this.cleanText($el.find('.b-advert-user-name, .seller-name').text());
          const externalId = $el.attr('data-advid') ?? this.extractListingId(link);

          if (title && price > 0) {
            products.push({
              externalId,
              platform: 'JIJI',
              title,
              price,
              currency: 'NGN',
              condition: classifyCondition(title),
              url: link.startsWith('http') ? link : `${PLATFORM_BASE_URLS.JIJI}${link}`,
              imageUrl: imageUrl || undefined,
              vendor: vendorName ? { externalId: '', name: vendorName } : undefined,
              metadata: { location: location || undefined, page },
            });
          }
        });
      } catch (err) {
        console.error(`Jiji search page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return products;
  }

  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const $ = await this.fetchHtml(url);

      const title = this.cleanText($('h1.b-advert-title, h1').first().text());
      const priceText = $('span.qa-advert-price, div.b-advert-info-price, .price').first().text();
      const price = this.cleanPrice(priceText);
      const imageUrl = $('img.b-advert-gallery__img, img.main-image').first().attr('src') ?? '';
      const description = this.cleanText($('div.b-advert-info-description, div.description').first().text());
      const location = this.cleanText($('span.b-advert-info-region, .location').first().text());

      const vendorName = this.cleanText($('a.b-seller-block__name, .seller-name').first().text());
      const vendorLink = $('a.b-seller-block__name, a[href*="seller"]').first().attr('href') ?? '';
      const memberSince = this.cleanText($('.b-seller-block__date, .member-since').first().text());

      if (!title || price <= 0) return null;

      const vendor: ScrapedVendor | undefined = vendorName ? {
        externalId: this.extractVendorId(vendorLink),
        name: vendorName,
        profileUrl: vendorLink.startsWith('http') ? vendorLink : `${PLATFORM_BASE_URLS.JIJI}${vendorLink}`,
      } : undefined;

      return {
        externalId: this.extractListingId(url),
        platform: 'JIJI',
        title,
        price,
        currency: 'NGN',
        condition: classifyCondition(title + ' ' + description),
        url,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        vendor,
        metadata: { location: location || undefined, memberSince: memberSince || undefined },
      };
    } catch (err) {
      console.error('Jiji product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getProductReviews(_productUrl: string, _maxPages = 1): Promise<ScrapedReview[]> {
    // Jiji is a classifieds platform — no review system. Return empty.
    return [];
  }

  private extractListingId(urlOrPath: string): string {
    const match = urlOrPath.match(/(\d{8,})/) || urlOrPath.match(/\/([^/]+)\.html/);
    return match ? match[1] : `jiji-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private extractVendorId(urlOrPath: string): string {
    const match = urlOrPath.match(/seller\/([^/?]+)/) || urlOrPath.match(/user\/([^/?]+)/);
    return match ? match[1] : '';
  }
}
