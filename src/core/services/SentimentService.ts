import axios from 'axios';
import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import { externalConfig } from '@/config';
import { NotFoundError } from '@/shared/errors';
import { sentimentEngine } from './NigerianSentimentEngine';
import type { SentimentResult } from '@/shared/types';

interface SentimentResponse {
  sentiment_score: number;
  confidence: number;
  key_complaints: string[];
  key_praises: string[];
  scam_signals: string[];
  label: string;
}

export class SentimentService {
  private sentimentApiUrl: string;
  private externalApiAvailable: boolean | null = null;

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

  /**
   * Analyze a single text. Tries external Python API first,
   * falls back to the built-in Nigerian Sentiment Engine.
   */
  async analyzeText(text: string, context = 'product_review', rating?: number | null): Promise<SentimentResponse> {
    // Try external API if it was previously available (or unknown)
    if (this.externalApiAvailable !== false) {
      try {
        const response = await axios.post(`${this.sentimentApiUrl}/analyze`, {
          text,
          context,
        }, { timeout: 10000 });

        this.externalApiAvailable = true;
        return response.data;
      } catch (err) {
        if (this.externalApiAvailable === null) {
          console.log('[sentiment] External API unavailable — using built-in Nigerian Sentiment Engine');
        }
        this.externalApiAvailable = false;
      }
    }

    // Built-in engine (always available)
    return this.builtInAnalysis(text, rating);
  }

  /**
   * Analyze a batch of texts. Tries external API first,
   * falls back to the built-in engine per-item.
   */
  async analyzeBatch(texts: { id: string; text: string; rating?: number | null }[]): Promise<Map<string, SentimentResponse>> {
    const results = new Map<string, SentimentResponse>();

    // Try external batch API
    if (this.externalApiAvailable !== false) {
      try {
        const response = await axios.post(`${this.sentimentApiUrl}/analyze/batch`, {
          texts: texts.map(t => ({ id: t.id, text: t.text })),
        }, { timeout: 60000 });

        this.externalApiAvailable = true;
        for (const item of response.data.results) {
          results.set(item.id, item);
        }
        return results;
      } catch {
        this.externalApiAvailable = false;
      }
    }

    // Built-in batch analysis
    const engineResults = sentimentEngine.analyzeBatch(texts);
    for (const [id, result] of engineResults) {
      results.set(id, result);
    }
    return results;
  }

  async analyzeAndStoreReviews(productId: string, reviewIds: string[]): Promise<number> {
    const reviews = await prisma.review.findMany({
      where: { id: { in: reviewIds } },
      include: { listing: true },
    });

    if (reviews.length === 0) return 0;

    const texts = reviews.map(r => ({
      id: r.id,
      text: `${r.title ?? ''} ${r.content}`.trim(),
      rating: r.rating,
    }));
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

  /**
   * Health check that reports both external API and built-in engine status.
   */
  async healthCheck(): Promise<{ external: boolean; builtin: boolean; overall: boolean }> {
    let external = false;
    try {
      const response = await axios.get(`${this.sentimentApiUrl}/health`, { timeout: 5000 });
      external = response.status === 200;
      this.externalApiAvailable = external;
    } catch {
      this.externalApiAvailable = false;
    }

    const builtin = sentimentEngine.healthCheck();

    return {
      external,
      builtin,
      overall: builtin || external, // We're good if at least the built-in works
    };
  }

  /**
   * Built-in analysis using the Nigerian Sentiment Engine
   */
  private builtInAnalysis(text: string, rating?: number | null): SentimentResponse {
    const result = sentimentEngine.analyze(text, 'product_review', rating);
    return {
      sentiment_score: result.sentiment_score,
      confidence: result.confidence,
      key_complaints: result.key_complaints,
      key_praises: result.key_praises,
      scam_signals: result.scam_signals,
      label: result.label,
    };
  }
}
