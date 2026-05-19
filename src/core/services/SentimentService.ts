import axios from 'axios';
import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import { externalConfig } from '@/config';
import { ExternalServiceError, NotFoundError } from '@/shared/errors';
import type { SentimentResult } from '@/shared/types';

interface PythonSentimentResponse {
  sentiment_score: number;
  confidence: number;
  key_complaints: string[];
  key_praises: string[];
  scam_signals: string[];
  label: string;
}

export class SentimentService {
  private sentimentApiUrl: string;

  constructor() {
    this.sentimentApiUrl = externalConfig.sentimentApiUrl;
  }

  async getProductSentiment(productId: string): Promise<{ sentiment: SentimentResult; cacheHit: boolean }> {
    const ck = cacheKey(CACHE_PREFIXES.SENTIMENT, productId);
    const cached = await cacheGet<SentimentResult>(ck);
    if (cached) return { sentiment: cached, cacheHit: true };

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundError('Product');

    const analyses = await prisma.sentimentAnalysis.findMany({
      where: { productId },
      orderBy: { analyzedAt: 'desc' },
    });

    if (analyses.length === 0) {
      const empty: SentimentResult = {
        productId,
        overallScore: 0,
        confidence: 0,
        totalReviews: 0,
        keyComplaints: [],
        keyPraises: [],
        scamSignals: [],
        platformBreakdown: [],
        lastAnalyzed: new Date().toISOString(),
      };
      return { sentiment: empty, cacheHit: false };
    }

    const scores = analyses.map(a => Number(a.sentimentScore));
    const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const confidence = analyses.reduce((a, b) => a + Number(b.confidence), 0) / analyses.length;

    const complaintMap = new Map<string, number>();
    const praiseMap = new Map<string, number>();
    const scamSignalSet = new Set<string>();

    for (const a of analyses) {
      for (const c of a.keyComplaints) complaintMap.set(c, (complaintMap.get(c) ?? 0) + 1);
      for (const p of a.keyPraises) praiseMap.set(p, (praiseMap.get(p) ?? 0) + 1);
      for (const s of a.scamSignals) scamSignalSet.add(s);
    }

    const keyComplaints = Array.from(complaintMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const keyPraises = Array.from(praiseMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);

    const platformGroups = new Map<string, { scores: number[]; count: number }>();
    for (const a of analyses) {
      const group = platformGroups.get(a.platform) ?? { scores: [], count: 0 };
      group.scores.push(Number(a.sentimentScore));
      group.count++;
      platformGroups.set(a.platform, group);
    }

    const platformBreakdown = Array.from(platformGroups.entries()).map(([platform, group]) => ({
      platform,
      score: Math.round((group.scores.reduce((a, b) => a + b, 0) / group.count) * 1000) / 1000,
      reviewCount: group.count,
    }));

    const sentiment: SentimentResult = {
      productId,
      overallScore: Math.round(overallScore * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      totalReviews: analyses.length,
      keyComplaints,
      keyPraises,
      scamSignals: Array.from(scamSignalSet),
      platformBreakdown,
      lastAnalyzed: analyses[0].analyzedAt.toISOString(),
    };

    await cacheSet(ck, sentiment, cacheConfig.sentiment);
    return { sentiment, cacheHit: false };
  }

  async analyzeText(text: string, context = 'product_review'): Promise<PythonSentimentResponse> {
    try {
      const response = await axios.post(`${this.sentimentApiUrl}/analyze`, {
        text,
        context,
      }, { timeout: 15000 });

      return response.data;
    } catch (err) {
      console.error('Sentiment API error:', err instanceof Error ? err.message : err);
      return this.fallbackAnalysis(text);
    }
  }

  async analyzeBatch(texts: { id: string; text: string }[]): Promise<Map<string, PythonSentimentResponse>> {
    const results = new Map<string, PythonSentimentResponse>();

    try {
      const response = await axios.post(`${this.sentimentApiUrl}/analyze/batch`, {
        texts: texts.map(t => ({ id: t.id, text: t.text })),
      }, { timeout: 60000 });

      for (const item of response.data.results) {
        results.set(item.id, item);
      }
    } catch {
      for (const t of texts) {
        results.set(t.id, this.fallbackAnalysis(t.text));
      }
    }

    return results;
  }

  async analyzeAndStoreReviews(productId: string, reviewIds: string[]): Promise<number> {
    const reviews = await prisma.review.findMany({
      where: { id: { in: reviewIds } },
      include: { listing: true },
    });

    if (reviews.length === 0) return 0;

    const texts = reviews.map(r => ({ id: r.id, text: `${r.title ?? ''} ${r.content}`.trim() }));
    const results = await this.analyzeBatch(texts);

    let stored = 0;
    for (const review of reviews) {
      const result = results.get(review.id);
      if (!result) continue;

      await prisma.sentimentAnalysis.upsert({
        where: { reviewId: review.id },
        update: {
          sentimentScore: result.sentiment_score,
          confidence: result.confidence,
          keyComplaints: result.key_complaints,
          keyPraises: result.key_praises,
          scamSignals: result.scam_signals,
          rawOutput: result as any,
        },
        create: {
          productId,
          reviewId: review.id,
          platform: review.platform,
          sentimentScore: result.sentiment_score,
          confidence: result.confidence,
          keyComplaints: result.key_complaints,
          keyPraises: result.key_praises,
          scamSignals: result.scam_signals,
          rawOutput: result as any,
        },
      });
      stored++;
    }

    return stored;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.sentimentApiUrl}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private fallbackAnalysis(text: string): PythonSentimentResponse {
    const lower = text.toLowerCase();
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'love', 'best', 'perfect', 'recommend', 'quality', 'fast', 'nice', 'wonderful', 'fantastic'];
    const negativeWords = ['bad', 'terrible', 'worst', 'hate', 'broken', 'fake', 'scam', 'poor', 'waste', 'slow', 'cheap', 'disappointed', 'refund', 'fraud'];
    const scamWords = ['scam', 'fake', 'fraud', 'counterfeit', 'not original', 'not genuine', 'different from', 'not as described', 'ripoff'];

    let posCount = 0;
    let negCount = 0;
    for (const w of positiveWords) if (lower.includes(w)) posCount++;
    for (const w of negativeWords) if (lower.includes(w)) negCount++;

    const total = posCount + negCount || 1;
    const score = (posCount - negCount) / total;
    const scamSignals = scamWords.filter(w => lower.includes(w));

    const complaints: string[] = [];
    const praises: string[] = [];
    for (const w of negativeWords) if (lower.includes(w)) complaints.push(w);
    for (const w of positiveWords) if (lower.includes(w)) praises.push(w);

    return {
      sentiment_score: Math.max(-1, Math.min(1, score)),
      confidence: 0.3,
      key_complaints: complaints.slice(0, 5),
      key_praises: praises.slice(0, 5),
      scam_signals: scamSignals,
      label: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral',
    };
  }
}
