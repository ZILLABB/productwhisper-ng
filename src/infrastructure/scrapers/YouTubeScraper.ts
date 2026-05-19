import axios from 'axios';
import { BaseScraper, ScraperSearchOptions } from './BaseScraper';
import { ScrapedProduct, ScrapedReview } from '@/shared/types';
import { externalConfig } from '@/config';

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  url: string;
}

export interface YouTubeComment {
  commentId: string;
  author: string;
  content: string;
  likeCount: number;
  publishedAt: string;
}

export class YouTubeScraper extends BaseScraper {
  private apiKey: string;
  private apiBase = 'https://www.googleapis.com/youtube/v3';

  constructor() {
    super('YOUTUBE', 'https://www.youtube.com');
    this.apiKey = externalConfig.youtubeApiKey;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async searchProducts(_options: ScraperSearchOptions): Promise<ScrapedProduct[]> {
    return [];
  }

  async getProductDetails(_url: string): Promise<ScrapedProduct | null> {
    return null;
  }

  async getProductReviews(_url: string, _maxPages?: number): Promise<ScrapedReview[]> {
    return [];
  }

  async searchVideos(query: string, maxResults = 10): Promise<YouTubeVideo[]> {
    if (!this.apiKey) return [];

    try {
      const searchResponse = await axios.get(`${this.apiBase}/search`, {
        params: {
          key: this.apiKey,
          q: `${query} Nigeria review`,
          part: 'snippet',
          type: 'video',
          regionCode: 'NG',
          relevanceLanguage: 'en',
          maxResults: Math.min(maxResults, 50),
          order: 'relevance',
        },
      });

      const videoIds = searchResponse.data.items
        .map((item: { id: { videoId: string } }) => item.id.videoId)
        .join(',');

      if (!videoIds) return [];

      const statsResponse = await axios.get(`${this.apiBase}/videos`, {
        params: {
          key: this.apiKey,
          id: videoIds,
          part: 'statistics,snippet',
        },
      });

      return statsResponse.data.items.map((item: {
        id: string;
        snippet: { title: string; channelTitle: string; publishedAt: string };
        statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
      }) => ({
        videoId: item.id,
        title: item.snippet.title,
        channelName: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        viewCount: parseInt(item.statistics.viewCount ?? '0'),
        likeCount: parseInt(item.statistics.likeCount ?? '0'),
        commentCount: parseInt(item.statistics.commentCount ?? '0'),
        url: `https://www.youtube.com/watch?v=${item.id}`,
      }));
    } catch (err) {
      console.error('YouTube search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async getVideoComments(videoId: string, maxResults = 100): Promise<YouTubeComment[]> {
    if (!this.apiKey) return [];

    const comments: YouTubeComment[] = [];
    let nextPageToken: string | undefined;

    try {
      do {
        const response = await axios.get(`${this.apiBase}/commentThreads`, {
          params: {
            key: this.apiKey,
            videoId,
            part: 'snippet',
            maxResults: Math.min(maxResults - comments.length, 100),
            order: 'relevance',
            textFormat: 'plainText',
            ...(nextPageToken && { pageToken: nextPageToken }),
          },
        });

        for (const item of response.data.items) {
          const snippet = item.snippet.topLevelComment.snippet;
          comments.push({
            commentId: item.id,
            author: snippet.authorDisplayName,
            content: snippet.textDisplay,
            likeCount: snippet.likeCount,
            publishedAt: snippet.publishedAt,
          });
        }

        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken && comments.length < maxResults);
    } catch (err) {
      console.error('YouTube comments fetch failed:', err instanceof Error ? err.message : err);
    }

    return comments;
  }
}
