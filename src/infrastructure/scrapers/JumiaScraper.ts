import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

export class JumiaScraper extends BaseScraper {
  constructor() {
    super('JUMIA', PLATFORM_BASE_URLS.JUMIA);
  }

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
              vendor: vendorName ? { externalId: '', name: vendorName, isVerified: vendorName.toLowerCase().includes('jumia') } : undefined,
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

  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const $ = await this.fetchHtml(url);

      const title = this.cleanText($('h1.-fs20.-pts').text() || $('h1').first().text());
      const priceText = $('span.-b.-ltr.-tal.-fs24').text() || $('span[data-price]').text();
      const price = this.cleanPrice(priceText);
      const imageUrl = $('img#img-main').attr('data-src') ?? $('img.swiper-lazy').first().attr('data-src') ?? '';
      const description = this.cleanText($('div.markup.-mhm.-pvl.-oxa.-sc').text());
      const vendorName = this.cleanText($('a[href*="seller"]').text() || $('div.-pvxs').find('a').first().text());
      const vendorLink = $('a[href*="seller"]').attr('href') ?? '';
      const externalId = this.extractProductId(url);
      const brand = this.cleanText($('a[href*="brand"]').text());

      if (!title || price <= 0) return null;

      const vendor: ScrapedVendor | undefined = vendorName ? {
        externalId: this.extractVendorId(vendorLink),
        name: vendorName,
        profileUrl: vendorLink.startsWith('http') ? vendorLink : `${PLATFORM_BASE_URLS.JUMIA}${vendorLink}`,
        isVerified: vendorName.toLowerCase().includes('jumia'),
      } : undefined;

      return {
        externalId,
        platform: 'JUMIA',
        title,
        price,
        currency: 'NGN',
        condition: classifyCondition(title),
        url,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        vendor,
        metadata: { brand: brand || undefined },
      };
    } catch (err) {
      console.error('Jumia product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async getProductReviews(productUrl: string, maxPages = 3): Promise<ScrapedReview[]> {
    const reviews: ScrapedReview[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const reviewUrl = `${productUrl}${productUrl.includes('?') ? '&' : '?'}page=${page}#reviews`;
        const $ = await this.fetchHtml(reviewUrl);

        $('article.rvw-item').each((_, el) => {
          const $el = $(el);
          const author = this.cleanText($el.find('.rvw-athr').text());
          const content = this.cleanText($el.find('.rvw-bd').text() || $el.find('p').text());
          const title = this.cleanText($el.find('.rvw-ttl').text());
          const ratingStars = $el.find('.stars._s').find('._y').length;
          const dateText = this.cleanText($el.find('.rvw-date').text());
          const helpfulText = this.cleanText($el.find('.rvw-hlp').text());

          if (content && content.length > 5) {
            reviews.push({
              externalId: `jumia-review-${reviews.length}-${Date.now()}`,
              author: author || undefined,
              rating: ratingStars > 0 ? ratingStars : undefined,
              title: title || undefined,
              content,
              helpfulCount: parseInt(helpfulText.replace(/\D/g, '')) || 0,
              postedAt: dateText || undefined,
            });
          }
        });

        const hasNextPage = $('a[aria-label="Next"]').length > 0;
        if (!hasNextPage) break;
      } catch (err) {
        console.error(`Jumia reviews page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return reviews;
  }

  private extractProductId(urlOrPath: string): string {
    const match = urlOrPath.match(/-(\d+)\.html/) || urlOrPath.match(/\/([^/]+)\.html/);
    return match ? match[1] : `jumia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private extractVendorId(urlOrPath: string): string {
    const match = urlOrPath.match(/seller\/([^/?]+)/);
    return match ? match[1] : '';
  }
}
