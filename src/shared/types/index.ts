import { z } from 'zod';

// ─── API Response Types ─────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  timestamp: string;
  requestId?: string;
  cache?: {
    hit: boolean;
    ttl?: number;
  };
  source?: string[];
  confidence?: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ─── Price Comparison Types ─────────────────────────────

export interface PriceComparison {
  productId: string;
  productName: string;
  lowestPrice: number;
  highestPrice: number;
  averagePrice: number;
  currency: string;
  platforms: PlatformPrice[];
  conditions: ConditionPrice[];
  priceHistory?: PricePoint[];
  lastUpdated: string;
}

export interface PlatformPrice {
  platform: string;
  price: number;
  condition: string;
  url: string;
  vendorName?: string;
  inStock: boolean;
  lastScraped: string;
}

export interface ConditionPrice {
  condition: string;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  listingCount: number;
}

export interface PricePoint {
  date: string;
  price: number;
  platform: string;
}

// ─── Sentiment Types ────────────────────────────────────

export interface SentimentResult {
  productId: string;
  overallScore: number;
  confidence: number;
  totalReviews: number;
  keyComplaints: string[];
  keyPraises: string[];
  scamSignals: string[];
  platformBreakdown: {
    platform: string;
    score: number;
    reviewCount: number;
  }[];
  lastAnalyzed: string;
}

// ─── Trust Types ────────────────────────────────────────

export interface TrustResult {
  entityId: string;
  entityType: 'product' | 'vendor';
  score: number;
  factors: TrustFactor[];
  scamFlags: string[];
  computedAt: string;
}

export interface TrustFactor {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

// ─── Scraper Types ──────────────────────────────────────

export interface ScrapedProduct {
  externalId: string;
  platform: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  url: string;
  imageUrl?: string;
  description?: string;
  vendor?: ScrapedVendor;
  reviews?: ScrapedReview[];
  metadata?: Record<string, unknown>;
}

export interface ScrapedVendor {
  externalId: string;
  name: string;
  profileUrl?: string;
  rating?: number;
  totalSales?: number;
  isVerified?: boolean;
}

export interface ScrapedReview {
  externalId: string;
  author?: string;
  rating?: number;
  title?: string;
  content: string;
  helpfulCount?: number;
  postedAt?: string;
}

// ─── Validation Schemas ─────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const ProductSearchSchema = z.object({
  q: z.string().min(1).max(500),
  category: z.string().optional(),
  brand: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  condition: z.enum(['NEW', 'UK_USED', 'FAIRLY_USED', 'REFURBISHED', 'OPEN_BOX']).optional(),
  platform: z.enum(['JUMIA', 'KONGA', 'JIJI', 'NAIRALAND', 'YOUTUBE']).optional(),
  sortBy: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'popular']).default('relevance'),
});

export const PriceCompareSchema = z.object({
  productId: z.string().uuid().optional(),
  q: z.string().min(1).max(500).optional(),
}).refine(d => d.productId || d.q, { message: 'Provide productId or q' });

export const SentimentQuerySchema = z.object({
  productId: z.string().uuid(),
  platform: z.enum(['JUMIA', 'KONGA', 'JIJI', 'NAIRALAND', 'YOUTUBE']).optional(),
});

export const TrustQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
}).refine(d => d.productId || d.vendorId, { message: 'Provide productId or vendorId' });

export type PaginationParams = z.infer<typeof PaginationSchema>;
