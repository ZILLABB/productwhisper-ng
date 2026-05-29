import { prisma } from '@/infrastructure/database/prisma';
import { cacheGet, cacheSet, cacheDelPattern, cacheConfig } from '@/infrastructure/cache/redis';
import { cacheKey, slugify, normalizeProductName, similarityScore, trigramSimilarity, extractBrand } from '@/shared/utils';
import { CACHE_PREFIXES } from '@/shared/constants';
import { NotFoundError, DatabaseError } from '@/shared/errors';
import { extractAttributes } from '@/core/matching';
import type { PaginationParams } from '@/shared/types';
import type { ProductCondition, Platform } from '@prisma/client';

interface ProductSearchFilters {
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: ProductCondition;
  platform?: Platform;
}

export class ProductService {
  async searchProducts(
    query: string,
    filters: ProductSearchFilters,
    pagination: PaginationParams,
    sortBy = 'relevance'
  ) {
    const ck = cacheKey(CACHE_PREFIXES.SEARCH, query, JSON.stringify(filters), pagination.page, pagination.limit, sortBy);
    const cached = await cacheGet<{ products: unknown[]; total: number }>(ck);
    if (cached) return { ...cached, cacheHit: true };

    const normalized = normalizeProductName(query);

    const where: Record<string, unknown> = {
      isActive: true,
      OR: [
        { name: { contains: normalized, mode: 'insensitive' } },
        { brand: { contains: normalized, mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: normalized, mode: 'insensitive' } } } },
      ],
    };

    if (filters.category) where.category = { contains: filters.category, mode: 'insensitive' };
    if (filters.brand) {
      // Support comma-separated multi-brand filter
      const brands = filters.brand.split(',').map(b => b.trim()).filter(Boolean);
      if (brands.length === 1) {
        where.brand = { contains: brands[0], mode: 'insensitive' };
      } else if (brands.length > 1) {
        where.brand = { in: brands, mode: 'insensitive' };
      }
    }

    const listingWhere: Record<string, unknown> = {};
    if (filters.minPrice || filters.maxPrice) {
      listingWhere.price = {};
      if (filters.minPrice) (listingWhere.price as Record<string, unknown>).gte = filters.minPrice;
      if (filters.maxPrice) (listingWhere.price as Record<string, unknown>).lte = filters.maxPrice;
    }
    if (filters.condition) listingWhere.condition = filters.condition;
    if (filters.platform) listingWhere.platform = filters.platform;

    if (Object.keys(listingWhere).length > 0) {
      where.listings = { some: listingWhere };
    }

    const orderBy = this.buildOrderBy(sortBy);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: where as any,
        include: {
          listings: { take: 5, orderBy: { price: 'asc' } },
          sentimentAnalyses: { take: 1, orderBy: { analyzedAt: 'desc' } },
          trustScores: { take: 1, orderBy: { computedAt: 'desc' } },
          _count: { select: { listings: true, sentimentAnalyses: true } },
        },
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.product.count({ where: where as any }),
    ]);

    const result = { products, total, cacheHit: false };
    await cacheSet(ck, { products, total }, cacheConfig.search);
    return result;
  }

  async getProductById(id: string) {
    const ck = cacheKey(CACHE_PREFIXES.PRODUCT, id);
    const cached = await cacheGet(ck);
    if (cached) return { product: cached, cacheHit: true };

    // Support lookup by UUID or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const product = isUuid
      ? await prisma.product.findUnique({
          where: { id },
          include: {
            listings: { orderBy: { price: 'asc' }, include: { vendor: true } },
            sentimentAnalyses: { take: 5, orderBy: { analyzedAt: 'desc' } },
            trustScores: { take: 1, orderBy: { computedAt: 'desc' } },
            aliases: true,
            _count: { select: { listings: true, sentimentAnalyses: true } },
          },
        })
      : await prisma.product.findUnique({
          where: { slug: id },
          include: {
            listings: { orderBy: { price: 'asc' }, include: { vendor: true } },
            sentimentAnalyses: { take: 5, orderBy: { analyzedAt: 'desc' } },
            trustScores: { take: 1, orderBy: { computedAt: 'desc' } },
            aliases: true,
            _count: { select: { listings: true, sentimentAnalyses: true } },
          },
        });

    if (!product) throw new NotFoundError('Product');

    await cacheSet(ck, product, cacheConfig.product);
    return { product, cacheHit: false };
  }

  async findOrCreateProduct(name: string, brand?: string | null, category?: string) {
    const normalized = normalizeProductName(name);
    const slug = slugify(normalized);

    const existing = await prisma.product.findFirst({
      where: {
        OR: [
          { slug },
          { name: { equals: normalized, mode: 'insensitive' } },
          { aliases: { some: { alias: { equals: normalized, mode: 'insensitive' } } } },
        ],
      },
    });

    if (existing) return existing;

    // Check fuzzy matches
    const candidates = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      take: 200,
    });

    for (const candidate of candidates) {
      const sim = Math.max(
        similarityScore(normalized, candidate.name),
        trigramSimilarity(normalized, candidate.name)
      );
      if (sim > 0.75) {
        await prisma.productAlias.upsert({
          where: { alias_source: { alias: normalized, source: 'MANUAL' } },
          update: {},
          create: { productId: candidate.id, alias: normalized, source: 'MANUAL' },
        });
        return prisma.product.findUnique({ where: { id: candidate.id } });
      }
    }

    const detectedBrand = brand ?? extractBrand(name);

    // Extract structured attributes from the product name
    const attrs = extractAttributes(name);

    return prisma.product.create({
      data: {
        name: normalized,
        slug,
        brand: detectedBrand || attrs.brand,
        category: category || attrs.category,
        model_name: attrs.model,
        storage: attrs.storage,
        ram: attrs.ram,
        color: attrs.color,
        variant: attrs.variant,
        productCondition: attrs.condition,
        isAccessory: attrs.isAccessory,
      },
    });
  }

  async getCategories() {
    const result = await prisma.product.groupBy({
      by: ['category'],
      _count: { category: true },
      where: { category: { not: null }, isActive: true },
      orderBy: { _count: { category: 'desc' } },
    });
    return result.map(r => ({ category: r.category!, count: r._count.category }));
  }

  async getBrands() {
    const result = await prisma.product.groupBy({
      by: ['brand'],
      _count: { brand: true },
      where: { brand: { not: null }, isActive: true },
      orderBy: { _count: { brand: 'desc' } },
    });
    return result.map(r => ({ brand: r.brand!, count: r._count.brand }));
  }

  async getTrendingProducts(limit = 10) {
    const ck = cacheKey(CACHE_PREFIXES.TRENDING, limit);
    const cached = await cacheGet(ck);
    if (cached) return { products: cached, cacheHit: true };

    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: {
        listings: { take: 3, orderBy: { price: 'asc' } },
        sentimentAnalyses: { take: 1, orderBy: { analyzedAt: 'desc' } },
        trustScores: { take: 1, orderBy: { computedAt: 'desc' } },
        _count: { select: { listings: true, sentimentAnalyses: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    await cacheSet(ck, products, cacheConfig.search);
    return { products, cacheHit: false };
  }

  private buildOrderBy(sortBy: string) {
    switch (sortBy) {
      case 'newest': return { createdAt: 'desc' as const };
      case 'name': return { name: 'asc' as const };
      default: return { updatedAt: 'desc' as const };
    }
  }
}
