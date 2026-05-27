import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import { classifyCondition, randomDelay } from '@/shared/utils';
import { PLATFORM_BASE_URLS } from '@/shared/constants';
import { scraperConfig } from '@/config';
import axios from 'axios';

const KONGA_GRAPHQL_URL = 'https://api.konga.com/v1/graphql';
const KONGA_IMAGE_BASE = 'https://www-konga-com-res.cloudinary.com/image/upload/f_auto,fl_lossy,dpr_auto,q_auto,w_640/media/catalog/product';

/**
 * KongaScraper — uses Konga's public GraphQL API for search and
 * server-rendered HTML for product details and reviews.
 */
export class KongaScraper extends BaseScraper {
  constructor() {
    super('KONGA', PLATFORM_BASE_URLS.KONGA);
  }

  /* ------------------------------------------------------------------ */
  /*  SEARCH — via Konga GraphQL API                                     */
  /* ------------------------------------------------------------------ */
  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];
    const maxResults = options.maxResults ?? 10;
    const maxPages = options.maxPages ?? 1;

    for (let page = 0; page < maxPages && products.length < maxResults; page++) {
      try {
        if (page > 0) await randomDelay(scraperConfig.delayMs, scraperConfig.delayMs * 2);

        const limit = Math.min(maxResults - products.length, 40);
        const query = `{
          searchByStore(
            search_term: [],
            numericFilters: [],
            sortBy: "",
            query: "${options.query.replace(/"/g, '\\"')}",
            paginate: { page: ${page}, limit: ${limit} },
            store_id: 1
          ) {
            pagination { limit, page, total }
            products {
              brand
              name
              price
              special_price
              original_price
              image_thumbnail
              image_thumbnail_path
              product_id
              url_key
              description
              seller { id, name, url, is_konga }
              stock { in_stock }
              categories { name }
            }
          }
        }`;

        const response = await axios.post(
          KONGA_GRAPHQL_URL,
          { query },
          {
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://www.konga.com',
              'Referer': 'https://www.konga.com/search',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000,
          }
        );

        const data = response.data?.data?.searchByStore;
        if (!data?.products?.length) break;

        for (const p of data.products) {
          if (products.length >= maxResults) break;

          const currentPrice = p.special_price || p.price || 0;
          if (!p.name || currentPrice <= 0) continue;

          const imageUrl = p.image_thumbnail
            ? `${KONGA_IMAGE_BASE}${p.image_thumbnail}`
            : undefined;

          const productUrl = p.url_key
            ? `${PLATFORM_BASE_URLS.KONGA}/product/${p.url_key}`
            : '';

          const vendor: ScrapedVendor | undefined = p.seller?.name
            ? {
                externalId: String(p.seller.id || ''),
                name: p.seller.name,
              }
            : undefined;

          const category = p.categories?.[0]?.name || '';

          products.push({
            externalId: String(p.product_id),
            platform: 'KONGA',
            title: p.name,
            price: currentPrice,
            currency: 'NGN',
            condition: classifyCondition(p.name),
            url: productUrl,
            imageUrl,
            description: typeof p.description === 'string' && !p.description.startsWith('[object')
              ? p.description.substring(0, 500)
              : undefined,
            vendor,
            metadata: {
              brand: p.brand || undefined,
              category: category || undefined,
              originalPrice: p.price && p.special_price && p.price > p.special_price ? p.price : undefined,
              inStock: p.stock?.in_stock ?? true,
            },
          });
        }

        // Stop if we've fetched all results
        if (data.pagination.total <= (page + 1) * limit) break;
      } catch (err) {
        console.error(`Konga GraphQL search page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return products;
  }

  /* ------------------------------------------------------------------ */
  /*  PRODUCT DETAILS — via server-rendered HTML                         */
  /* ------------------------------------------------------------------ */
  async getProductDetails(url: string): Promise<ScrapedProduct | null> {
    try {
      const fullUrl = url.startsWith('http') ? url : `${PLATFORM_BASE_URLS.KONGA}${url}`;
      const $ = await this.fetchHtml(fullUrl);

      // Title — CSS modules: [class*="productName"] is most reliable.
      // h1 on Konga is the breadcrumb category, NOT the product name.
      let title = this.cleanText($('[class*="productName"]').first().text());
      if (!title) {
        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
        title = ogTitle.split('|')[0].trim();
      }
      if (!title) {
        title = $('title').text().split('|')[0].trim();
      }

      // Price — [class*="priceBox"]
      const priceBoxText = $('[class*="priceBox"]').first().text();
      const priceMatch = priceBoxText.match(/₦([\d,]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

      const allPrices = priceBoxText.match(/₦([\d,]+)/g) || [];
      const originalPrice = allPrices.length > 1
        ? parseFloat(allPrices[1].replace(/[₦,]/g, ''))
        : undefined;

      // Image — lazy-loaded, so use srcset or og:image
      let imageUrl = $('meta[property="og:image"]').attr('content') ?? '';
      if (!imageUrl || imageUrl.includes('og-image')) {
        const srcset = $('[class*="productImage"] img, [class*="carouselWrapper"] img').first().attr('srcset') ?? '';
        const srcsetMatch = srcset.match(/(https:\/\/[^\s]+cloudinary[^\s]+)\s/);
        imageUrl = srcsetMatch ? srcsetMatch[1] : '';
      }

      // Description
      const description = this.cleanText(
        $('[class*="description"], [class*="productDescription"], [class*="keyFeatures"], [class*="overview"]').first().text()
      ).substring(0, 1000);

      // Seller
      const vendorName = this.cleanText($('[class*="sellerName"]').first().text());
      const vendorRatingText = $('[class*="sellerRating"], [class*="sellerRatingsWrapper"]').text();
      const vendorRatingMatch = vendorRatingText.match(/([\d.]+)\s*\/\s*5/);

      // Brand from breadcrumbs
      let brand = '';
      const breadcrumbs = $('[class*="BreadCrumb"] a, [class*="breadcrumb"] a')
        .map((_, el) => $(el).text().trim())
        .get();
      if (breadcrumbs.length > 0) {
        brand = breadcrumbs[breadcrumbs.length - 1];
      }

      if (!title || price <= 0) return null;

      const vendor: ScrapedVendor | undefined = vendorName
        ? {
            externalId: vendorName.toLowerCase().replace(/\s+/g, '-'),
            name: vendorName,
            rating: vendorRatingMatch ? parseFloat(vendorRatingMatch[1]) : undefined,
          }
        : undefined;

      return {
        externalId: this.extractProductId(fullUrl),
        platform: 'KONGA',
        title,
        price,
        currency: 'NGN',
        condition: classifyCondition(title),
        url: fullUrl,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        vendor,
        metadata: {
          brand: brand || undefined,
          originalPrice,
        },
      };
    } catch (err) {
      console.error('Konga product details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  REVIEWS — from detail page HTML                                    */
  /* ------------------------------------------------------------------ */
  async getProductReviews(productUrl: string, _maxPages = 1): Promise<ScrapedReview[]> {
    const reviews: ScrapedReview[] = [];

    try {
      const fullUrl = productUrl.startsWith('http') ? productUrl : `${PLATFORM_BASE_URLS.KONGA}${productUrl}`;
      const $ = await this.fetchHtml(fullUrl);

      $('[class*="reviewItem"], [class*="ReviewItem"], [class*="review-item"], article[class*="review"]').each((_, el) => {
        const $el = $(el);
        const author = this.cleanText(
          $el.find('[class*="reviewerName"], [class*="reviewAuthor"], [class*="author"]').text()
        );
        const content = this.cleanText(
          $el.find('[class*="reviewText"], [class*="reviewBody"], [class*="reviewContent"], p').first().text()
        );
        const title = this.cleanText(
          $el.find('[class*="reviewTitle"], h4, h5').first().text()
        );
        const ratingEl = $el.find('[class*="rating"], [class*="star"]');
        const ratingText = ratingEl.attr('data-rating') || ratingEl.attr('style') || '';
        const ratingMatch = ratingText.match(/(\d)/);
        const dateText = this.cleanText(
          $el.find('[class*="reviewDate"], [class*="date"], time').first().text()
        );

        if (content && content.length > 5) {
          reviews.push({
            externalId: `konga-review-${reviews.length}-${Date.now()}`,
            author: author || undefined,
            rating: ratingMatch ? parseInt(ratingMatch[1]) : undefined,
            title: title || undefined,
            content,
            postedAt: dateText || undefined,
          });
        }
      });
    } catch (err) {
      console.error('Konga reviews failed:', err instanceof Error ? err.message : err);
    }

    return reviews;
  }

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                            */
  /* ------------------------------------------------------------------ */
  private extractProductId(urlOrPath: string): string {
    const match = urlOrPath.match(/-(\d{5,})(?:\?|$)/);
    if (match) return match[1];
    const pathMatch = urlOrPath.match(/\/product\/([^/?]+)/);
    return pathMatch ? pathMatch[1] : `konga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
