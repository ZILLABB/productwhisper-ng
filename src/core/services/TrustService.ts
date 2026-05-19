import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import { NotFoundError } from '@/shared/errors';
import type { TrustResult, TrustFactor } from '@/shared/types';

export class TrustService {
  async getProductTrust(productId: string): Promise<{ trust: TrustResult; cacheHit: boolean }> {
    const ck = cacheKey(CACHE_PREFIXES.TRUST, 'product', productId);
    const cached = await cacheGet<TrustResult>(ck);
    if (cached) return { trust: cached, cacheHit: true };

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        listings: { include: { vendor: true, reviews: true } },
        sentimentAnalyses: true,
      },
    });

    if (!product) throw new NotFoundError('Product');

    const factors: TrustFactor[] = [];
    const scamFlags: string[] = [];

    // Factor 1: Listing consistency (weight 25)
    const listingConsistency = this.evaluateListingConsistency(product.listings);
    factors.push({ name: 'Listing Consistency', score: listingConsistency.score, weight: 25, detail: listingConsistency.detail });
    scamFlags.push(...listingConsistency.flags);

    // Factor 2: Price reasonableness (weight 20)
    const priceReason = this.evaluatePriceReasonableness(product.listings);
    factors.push({ name: 'Price Reasonableness', score: priceReason.score, weight: 20, detail: priceReason.detail });
    scamFlags.push(...priceReason.flags);

    // Factor 3: Vendor reliability (weight 25)
    const vendorReliability = this.evaluateVendorReliability(product.listings);
    factors.push({ name: 'Vendor Reliability', score: vendorReliability.score, weight: 25, detail: vendorReliability.detail });
    scamFlags.push(...vendorReliability.flags);

    // Factor 4: Sentiment signals (weight 20)
    const sentimentSignals = this.evaluateSentimentSignals(product.sentimentAnalyses);
    factors.push({ name: 'Sentiment Signals', score: sentimentSignals.score, weight: 20, detail: sentimentSignals.detail });
    scamFlags.push(...sentimentSignals.flags);

    // Factor 5: Data completeness (weight 10)
    const dataCompleteness = this.evaluateDataCompleteness(product);
    factors.push({ name: 'Data Completeness', score: dataCompleteness.score, weight: 10, detail: dataCompleteness.detail });

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight;
    const score = Math.round(Math.max(0, Math.min(100, weightedScore)));

    const trust: TrustResult = {
      entityId: productId,
      entityType: 'product',
      score,
      factors,
      scamFlags: [...new Set(scamFlags)],
      computedAt: new Date().toISOString(),
    };

    await prisma.trustScore.create({
      data: {
        productId,
        score,
        factors: factors as any,
        scamFlags,
      },
    });

    await cacheSet(ck, trust, cacheConfig.sentiment);
    return { trust, cacheHit: false };
  }

  async getVendorTrust(vendorId: string): Promise<{ trust: TrustResult; cacheHit: boolean }> {
    const ck = cacheKey(CACHE_PREFIXES.TRUST, 'vendor', vendorId);
    const cached = await cacheGet<TrustResult>(ck);
    if (cached) return { trust: cached, cacheHit: true };

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { listings: { include: { reviews: true } } },
    });

    if (!vendor) throw new NotFoundError('Vendor');

    const factors: TrustFactor[] = [];
    const scamFlags: string[] = [];

    // Vendor-specific factors
    const verifiedScore = vendor.isVerified ? 90 : 40;
    factors.push({ name: 'Verification Status', score: verifiedScore, weight: 30, detail: vendor.isVerified ? 'Verified vendor' : 'Unverified vendor' });

    const salesScore = Math.min(100, (vendor.totalSales / 50) * 100);
    factors.push({ name: 'Sales Volume', score: salesScore, weight: 20, detail: `${vendor.totalSales} total sales` });

    const ratingScore = vendor.rating ? Number(vendor.rating) * 20 : 50;
    factors.push({ name: 'Vendor Rating', score: ratingScore, weight: 25, detail: vendor.rating ? `${vendor.rating}/5 rating` : 'No rating' });

    const accountAge = vendor.joinDate ? (Date.now() - vendor.joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30) : 0;
    const ageScore = Math.min(100, accountAge * 5);
    factors.push({ name: 'Account Age', score: ageScore, weight: 15, detail: `${Math.round(accountAge)} months` });
    if (accountAge < 1) scamFlags.push('New vendor account (< 1 month)');

    const reviewCount = vendor.listings.reduce((sum, l) => sum + l.reviews.length, 0);
    const reviewScore = Math.min(100, (reviewCount / 10) * 100);
    factors.push({ name: 'Review Coverage', score: reviewScore, weight: 10, detail: `${reviewCount} reviews across listings` });

    if (!vendor.isVerified && vendor.totalSales < 5) scamFlags.push('Unverified with very few sales');

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight;
    const score = Math.round(Math.max(0, Math.min(100, weightedScore)));

    const trust: TrustResult = {
      entityId: vendorId,
      entityType: 'vendor',
      score,
      factors,
      scamFlags: [...new Set(scamFlags)],
      computedAt: new Date().toISOString(),
    };

    await prisma.trustScore.create({
      data: {
        vendorId,
        score,
        factors: factors as any,
        scamFlags,
      },
    });

    await cacheSet(ck, trust, cacheConfig.sentiment);
    return { trust, cacheHit: false };
  }

  private evaluateListingConsistency(listings: any[]) {
    const flags: string[] = [];
    if (listings.length === 0) return { score: 50, detail: 'No listings to evaluate', flags };

    const prices = listings.map(l => Number(l.price));
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length);
    const cv = avg > 0 ? (stdDev / avg) * 100 : 0;

    if (cv > 50) {
      flags.push('Extreme price variation across listings');
      return { score: 30, detail: `${Math.round(cv)}% price coefficient of variation`, flags };
    }
    if (cv > 30) {
      flags.push('High price variation across listings');
      return { score: 55, detail: `${Math.round(cv)}% price coefficient of variation`, flags };
    }
    return { score: 85, detail: `${Math.round(cv)}% price coefficient of variation — consistent`, flags };
  }

  private evaluatePriceReasonableness(listings: any[]) {
    const flags: string[] = [];
    if (listings.length === 0) return { score: 50, detail: 'No price data', flags };

    const prices = listings.map(l => Number(l.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    if (minPrice < 500) {
      flags.push('Suspiciously low price detected');
      return { score: 20, detail: `Minimum price is ${minPrice} NGN — likely scam`, flags };
    }

    if (maxPrice > 0 && minPrice > 0 && maxPrice / minPrice > 5) {
      flags.push('Price spread too wide (5x+ difference)');
      return { score: 40, detail: `Price range: ${minPrice}-${maxPrice} NGN`, flags };
    }

    return { score: 80, detail: `Price range: ${minPrice}-${maxPrice} NGN — reasonable`, flags };
  }

  private evaluateVendorReliability(listings: any[]) {
    const flags: string[] = [];
    const vendors = listings.filter(l => l.vendor).map(l => l.vendor);
    if (vendors.length === 0) return { score: 40, detail: 'No vendor information', flags: ['No vendor data available'] };

    const verified = vendors.filter(v => v.isVerified).length;
    const verifiedPct = (verified / vendors.length) * 100;

    if (verifiedPct === 0) flags.push('No verified vendors selling this product');
    if (verifiedPct > 50) return { score: 85, detail: `${Math.round(verifiedPct)}% verified vendors`, flags };
    return { score: 50, detail: `${Math.round(verifiedPct)}% verified vendors`, flags };
  }

  private evaluateSentimentSignals(analyses: any[]) {
    const flags: string[] = [];
    if (analyses.length === 0) return { score: 50, detail: 'No sentiment data', flags };

    const scores = analyses.map(a => Number(a.sentimentScore));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    const allScamSignals = analyses.flatMap(a => a.scamSignals);
    if (allScamSignals.length > 0) {
      flags.push(...new Set(allScamSignals));
    }

    const negativeCount = scores.filter(s => s < -0.3).length;
    if (negativeCount > scores.length * 0.5) flags.push('Majority negative sentiment');

    const sentimentScore = Math.round(((avg + 1) / 2) * 100);
    return { score: Math.max(0, sentimentScore), detail: `Average sentiment: ${avg.toFixed(3)} (${analyses.length} analyses)`, flags };
  }

  private evaluateDataCompleteness(product: any) {
    let complete = 0;
    const total = 5;
    if (product.name) complete++;
    if (product.brand) complete++;
    if (product.category) complete++;
    if (product.listings.length > 0) complete++;
    if (product.sentimentAnalyses.length > 0) complete++;

    return { score: (complete / total) * 100, detail: `${complete}/${total} data fields populated` };
  }
}
