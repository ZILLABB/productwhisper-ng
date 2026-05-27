import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

/**
 * JijiScraper — Jiji.ng is a classifieds marketplace (SSR HTML).
 *
 * Key structural notes (as of 2024-2025):
 *  - Search results: `.qa-advert-list-item` is the card element and is itself
 *    an `<a>` tag (the href is on the card, not on a child link).
 *  - Title: `.b-advert-title-inner` / `.qa-advert-title`
 *  - Price: `.qa-advert-price`
 *  - Image: `<img>` inside `.b-list-advert-base__img`
 *  - Location: `.b-list-advert__region__text`
 *  - Condition: `.b-list-advert-base__item-attr` (Brand New / Used)
 *  - Jiji has NO review system — `getProductReviews` always returns [].
 */
export class JijiScraper extends BaseScraper {
  constructor() {
    super('JIJI', PLATFORM_BASE_URLS.JIJI);
  }

  /* ------------------------------------------------------------------ */
  /*  SEARCH                                                             */
  /* ------------------------------------------------------------------ */
  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];
    const maxPages = options.maxPages ?? 2;
    const maxResults = options.maxResults ?? 20;

    for (let page = 1; page <= maxPages && products.length < maxResults; page++) {
      try {
        const searchUrl = `/search?query=${encodeURIComponent(options.query)}${page > 1 ? `&page=${page}` : ''}`;
        const $ = await this.fetchHtml(searchUrl);

        // The card element (.qa-advert-list-item) is itself an <a> tag.
        // Also try older selectors as fallback.
        $('.qa-advert-list-item, div[data-advid], li.masonry-item').each((_, el) => {
          if (products.length >= maxResults) return;

          const $el = $(el);

          // Link — the card IS the <a>, so href is on the element itself.
          // Fall back to looking for a child <a> for older layouts.
          const link = $el.attr('href') ?? $el.find('a').first().attr('href') ?? '';

          const title = this.cleanText(
            $el.find('.b-advert-title-inner, .qa-advert-title, h3').first().text()
          );

          const priceText = $el.find('.qa-advert-price, .b-list-advert__price-base, .b-list-advert__aside__price').first().text();
          const price = this.cleanPrice(priceText);

          const imageUrl = $el.find('img').first().attr('src') ?? $el.find('img').first().attr('data-src') ?? '';

          const location = this.cleanText(
            $el.find('.b-list-advert__region__text, .b-advert-info-region').first().text()
          );

          const conditionText = this.cleanText(
            $el.find('.b-list-advert-base__item-attr').first().text()
          );

          const description = this.cleanText(
            $el.find('.b-list-advert-base__description-text').first().text()
          );

          const externalId = this.extractListingId(link);

          if (title && price > 0) {
            products.push({
              externalId,
              platform: 'JIJI',
              title,
              price,
              currency: 'NGN',
              condition: conditionText
                ? classifyCondition(conditionText)
                : classifyCondition(title),
              url: link.startsWith('http') ? link : `${PLATFORM_BASE_URLS.JIJI}${link.split('?')[0]}`,
              imageUrl: imageUrl || undefined,
              description: description || undefined,
              metadata: {
                location: location || undefined,
                page,
              },
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

  /* ------------------------------------------------------------------ */
  /*  PRODUCT DETAILS                                                    */
  /* ------------------------------------------------------------------ */
  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const fullUrl = url.startsWith('http') ? url : `${PLATFORM_BASE_URLS.JIJI}${url}`;
      const $ = await this.fetchHtml(fullUrl);

      const title = this.cleanText(
        $('h1, .b-advert-title, [class*="advert-title"]').first().text()
      );

      const priceText = $(
        '.qa-advert-price, [class*="advert-price"], [class*="price"]'
      ).first().text();
      const price = this.cleanPrice(priceText);

      // Image — try gallery images first, then any product image
      const imageUrl =
        $('[class*="advert-gallery"] img, [class*="gallery"] img').first().attr('src') ??
        $('img[class*="advert"]').first().attr('src') ??
        $('meta[property="og:image"]').attr('content') ??
        '';

      const description = this.cleanText(
        $('[class*="advert-info-description"], [class*="description"], [class*="advert-body"]').first().text()
      );

      const location = this.cleanText(
        $('[class*="advert-info-region"], [class*="region"], [class*="location"]').first().text()
      );

      // Seller
      const vendorName = this.cleanText(
        $('[class*="seller-block__name"], [class*="seller-name"], a[href*="/seller/"]').first().text()
      );
      const vendorLink = $('a[href*="/seller/"], [class*="seller-block__name"]').first().attr('href') ?? '';
      const memberSince = this.cleanText(
        $('[class*="seller-block__date"], [class*="member-since"]').first().text()
      );

      // Condition
      const conditionText = this.cleanText(
        $('[class*="item-attr"], [class*="condition"]').first().text()
      );

      if (!title || price <= 0) return null;

      const vendor: ScrapedVendor | undefined = vendorName
        ? {
            externalId: this.extractVendorId(vendorLink),
            name: vendorName,
            profileUrl: vendorLink
              ? (vendorLink.startsWith('http') ? vendorLink : `${PLATFORM_BASE_URLS.JIJI}${vendorLink}`)
              : undefined,
          }
        : undefined;

      return {
        externalId: this.extractListingId(fullUrl),
        platform: 'JIJI',
        title,
        price,
        currency: 'NGN',
        condition: conditionText
          ? classifyCondition(conditionText)
          : classifyCondition(title + ' ' + description),
        url: fullUrl,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        vendor,
        metadata: {
          location: location || undefined,
          memberSince: memberSince || undefined,
        },
      };
    } catch (err) {
      console.error('Jiji product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  REVIEWS — Jiji has no review system                                */
  /* ------------------------------------------------------------------ */
  async getProductReviews(_productUrl: string, _maxPages = 1): Promise<ScrapedReview[]> {
    return [];
  }

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                            */
  /* ------------------------------------------------------------------ */
  private extractListingId(urlOrPath: string): string {
    // Jiji URLs end with a hash-like ID before .html: ...-HASHID.html
    const htmlMatch = urlOrPath.match(/[-/]([A-Za-z0-9_-]{10,})\.html/);
    if (htmlMatch) return htmlMatch[1];
    const numMatch = urlOrPath.match(/(\d{8,})/);
    return numMatch ? numMatch[1] : `jiji-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private extractVendorId(urlOrPath: string): string {
    const match = urlOrPath.match(/seller\/([^/?]+)/) || urlOrPath.match(/user\/([^/?]+)/);
    return match ? match[1] : '';
  }
}
