import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview } from '@/shared/types';
import { PLATFORM_BASE_URLS } from '@/shared/constants';

export interface NairalandPost {
  externalId: string;
  title: string;
  content: string;
  author: string;
  url: string;
  postedAt?: string;
  section: string;
  replies: NairalandReply[];
}

export interface NairalandReply {
  author: string;
  content: string;
  postedAt?: string;
}

export class NairalandScraper extends BaseScraper {
  constructor() {
    super('NAIRALAND', PLATFORM_BASE_URLS.NAIRALAND);
  }

  async searchProducts(options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    // Nairaland doesn't have products — it has discussions. We convert discussions to "mentions"
    // This method returns empty; use searchDiscussions() instead for sentiment data.
    return [];
  }

  async getProductDetails(_url: string): Promise<ScrapedProduct | null> {
    return null;
  }

  async getProductReviews(_url: string, _maxPages?: number): Promise<ScrapedReview[]> {
    return [];
  }

  async searchDiscussions(query: string, maxPages = 3): Promise<NairalandPost[]> {
    const posts: NairalandPost[] = [];

    for (let page = 0; page < maxPages; page++) {
      try {
        const searchUrl = `/search/${encodeURIComponent(query)}/${page}`;
        const $ = await this.fetchHtml(searchUrl);

        $('table.boards td.featured, table tr td.bold').each((_, el) => {
          const $el = $(el);
          const $link = $el.find('a[href*="/"]').first();
          const title = this.cleanText($link.text());
          const href = $link.attr('href') ?? '';
          const section = this.cleanText($el.find('a[href*="board"]').text());
          const dateText = this.cleanText($el.find('.s').text());

          if (title && href) {
            posts.push({
              externalId: this.extractPostId(href),
              title,
              content: '',
              author: '',
              url: href.startsWith('http') ? href : `${PLATFORM_BASE_URLS.NAIRALAND}${href}`,
              postedAt: dateText || undefined,
              section: section || 'General',
              replies: [],
            });
          }
        });

        // Also try the simpler search result format
        if (posts.length === 0) {
          $('b a[href]').each((_, el) => {
            const $link = $(el);
            const title = this.cleanText($link.text());
            const href = $link.attr('href') ?? '';

            if (title && href && href.includes('/') && !href.startsWith('http://www.nairaland.com/search')) {
              posts.push({
                externalId: this.extractPostId(href),
                title,
                content: '',
                author: '',
                url: href.startsWith('http') ? href : `${PLATFORM_BASE_URLS.NAIRALAND}/${href}`,
                section: 'General',
                replies: [],
              });
            }
          });
        }
      } catch (err) {
        console.error(`Nairaland search page ${page} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }

    return posts;
  }

  async getDiscussionDetails(url: string): Promise<NairalandPost | null> {
    try {
      const $ = await this.fetchHtml(url);

      const title = this.cleanText($('h2, title').first().text().replace(' - Nairaland', ''));
      const posts = $('div.narrow');

      if (posts.length === 0) return null;

      const $firstPost = posts.first();
      const author = this.cleanText($firstPost.find('a.user').first().text());
      const content = this.cleanText($firstPost.find('.narrow').text() || $firstPost.text());

      const replies: NairalandReply[] = [];
      posts.slice(1).each((_, el) => {
        const $reply = $(el);
        const replyAuthor = this.cleanText($reply.find('a.user').first().text());
        const replyContent = this.cleanText($reply.text());
        const replyDate = this.cleanText($reply.find('.s').first().text());

        if (replyContent && replyContent.length > 10) {
          replies.push({
            author: replyAuthor || 'Anonymous',
            content: replyContent.substring(0, 2000),
            postedAt: replyDate || undefined,
          });
        }
      });

      return {
        externalId: this.extractPostId(url),
        title,
        content: content.substring(0, 5000),
        author: author || 'Anonymous',
        url,
        section: 'General',
        replies,
      };
    } catch (err) {
      console.error('Nairaland discussion details failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private extractPostId(urlOrPath: string): string {
    const match = urlOrPath.match(/\/(\d+)\//);
    return match ? match[1] : `nairaland-${Date.now()}`;
  }
}
