/**
 * ProductMatcher — Intelligent cross-platform product grouping.
 *
 * Replaces the old Jaccard bigram similarity approach with:
 *   1. Structured attribute extraction
 *   2. Hard-gate validation (category, brand, model, storage)
 *   3. Confidence scoring
 *   4. Fake savings prevention
 *
 * Philosophy: NO COMPARISON is better than WRONG COMPARISON.
 */

import {
  extractAttributes,
  validateMatch,
  isPriceSuspiciousForCategory,
  type ProductAttributes,
  type MatchResult,
} from './AttributeExtractor';

// ─── Types ──────────────────────────────────────────────

export interface ScrapedProductInput {
  externalId: string;
  platform: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  url: string;
  imageUrl?: string;
  description?: string;
  vendor?: {
    externalId: string;
    name: string;
    profileUrl?: string;
    rating?: number;
    totalSales?: number;
    isVerified?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface MatchedGroup {
  groupId: string;
  name: string;
  listings: GroupListing[];
  lowestPrice: number;
  highestPrice: number;
  cheapestPlatform: string;
  savings: number;
  platformCount: number;
  matchConfidence: number;
  matchExplanation: string;
  matchedAttributes: string[];
  mismatchedAttributes: string[];
  attributes: {
    brand: string | null;
    model: string | null;
    storage: string | null;
    category: string;
    condition: string;
  };
  conditionWarning?: string; // if mixing new/used
}

export interface GroupListing {
  platform: string;
  product: ScrapedProductInput;
  vendorName?: string;
  trustLevel: string;
  trustScore: number;
  scamFlags: string[];
  attributes: ProductAttributes;
}

export interface MatchingResult {
  groups: MatchedGroup[];
  unmatched: ScrapedProductInput[];
  filteredAsAccessories: ScrapedProductInput[];
  stats: {
    totalInput: number;
    totalGrouped: number;
    totalUnmatched: number;
    totalFilteredAccessories: number;
    groupCount: number;
    avgConfidence: number;
  };
}

// ─── Seller Trust Scoring ───────────────────────────────

function computeSellerTrust(vendor: ScrapedProductInput['vendor'], platform: string): {
  trustLevel: string;
  trustScore: number;
  scamFlags: string[];
  displayName: string;
} {
  const scamFlags: string[] = [];

  if (!vendor || !vendor.name) {
    return {
      trustLevel: 'unknown',
      trustScore: 25,
      scamFlags: ['No seller information available'],
      displayName: `${platform} Marketplace Seller`,
    };
  }

  let trustLevel = 'unknown';
  let trustScore = 30;

  // Normalize the seller name
  const displayName = normalizeSelleName(vendor.name, platform);

  // Rating-based scoring
  if (vendor.rating && vendor.rating >= 4) {
    trustLevel = 'trusted';
    trustScore = 85 + Math.min(15, (vendor.totalSales || 0) / 100);
  } else if (vendor.rating && vendor.rating >= 3) {
    trustLevel = 'average';
    trustScore = 50 + (vendor.rating - 3) * 35;
  } else if (vendor.rating && vendor.rating < 3) {
    trustLevel = 'caution';
    trustScore = Math.max(10, vendor.rating * 15);
    scamFlags.push('Low seller rating');
  } else if (vendor.isVerified) {
    trustLevel = 'verified';
    trustScore = 70;
  }

  // Official store boost
  if (vendor.name && /\b(official\s*store|jumia\s*express|konga\s*verified)\b/i.test(vendor.name)) {
    trustLevel = trustLevel === 'unknown' ? 'verified' : trustLevel;
    trustScore = Math.max(trustScore, 80);
  }

  // Platform marketplace boost
  if (vendor.name && /\b(jumia|konga)\b/i.test(vendor.name)) {
    trustScore = Math.max(trustScore, 75);
  }

  // New seller warning
  if (!vendor.rating && !vendor.isVerified && (!vendor.totalSales || vendor.totalSales < 5)) {
    scamFlags.push('New or unrated seller — verify before buying');
  }

  return {
    trustLevel,
    trustScore: Math.round(Math.min(100, trustScore)),
    scamFlags,
    displayName,
  };
}

/**
 * Normalize seller names.
 * Replaces "Unknown Seller 30" style names with meaningful labels.
 */
function normalizeSelleName(name: string, platform: string): string {
  if (!name) return `${platform} Marketplace Seller`;

  // Clean up whitespace and formatting
  let cleaned = name.trim().replace(/\s+/g, ' ');

  // Pattern: "Unknown Seller N" or "Seller N"
  if (/^(unknown\s+)?seller\s+\d+$/i.test(cleaned)) {
    return `${platform} Marketplace Seller`;
  }

  // Pattern: just a number
  if (/^\d+$/.test(cleaned)) {
    return `${platform} Marketplace Seller`;
  }

  // Pattern: empty or very short
  if (cleaned.length < 2) {
    return `${platform} Marketplace Seller`;
  }

  // Pattern: URL-style names
  if (/^https?:\/\//.test(cleaned)) {
    return `${platform} Marketplace Seller`;
  }

  // Capitalize properly
  if (cleaned === cleaned.toLowerCase() || cleaned === cleaned.toUpperCase()) {
    cleaned = cleaned.replace(/\b\w/g, c => c.toUpperCase());
  }

  return cleaned;
}

// ─── Main Matching Engine ───────────────────────────────

/**
 * Group products from multiple platforms using structured attribute matching.
 *
 * Steps:
 *   1. Extract attributes from every product title
 *   2. Filter out accessories (unless query is for accessories)
 *   3. Filter out price-suspicious items
 *   4. Group by validated attribute matching (hard gates + confidence)
 *   5. Score and rank groups
 */
export function matchProducts(
  products: ScrapedProductInput[],
  options: {
    queryIsAccessory?: boolean;
    averagePrice?: number;
    minConfidence?: number;
  } = {}
): MatchingResult {
  const { queryIsAccessory = false, minConfidence = 40 } = options;

  // Step 1: Extract attributes for every product
  const items = products.map(p => ({
    product: p,
    attributes: extractAttributes(p.title),
    grouped: false,
  }));

  // Step 2: Filter accessories (unless query is for accessories)
  const filteredAsAccessories: ScrapedProductInput[] = [];
  const candidates: typeof items = [];

  for (const item of items) {
    if (!queryIsAccessory && item.attributes.isAccessory) {
      filteredAsAccessories.push(item.product);
    } else if (queryIsAccessory && !item.attributes.isAccessory) {
      // If searching for accessories, filter out main devices
      // (But don't add to filteredAsAccessories — those are separate)
      candidates.push(item); // Keep them as candidates for now
    } else {
      candidates.push(item);
    }
  }

  // Step 3: Filter price-suspicious items
  for (const item of [...candidates]) {
    if (isPriceSuspiciousForCategory(item.product.price, item.attributes.category)) {
      // Don't hard-filter, but mark as suspicious
      item.attributes.isAccessory = true;
      item.attributes.category = 'GENERAL_ACCESSORY' as any;
    }
  }

  // Step 4: Group by validated attribute matching
  const groups: MatchedGroup[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].grouped) continue;

    const anchor = candidates[i];
    anchor.grouped = true;

    const cluster: { item: typeof items[0]; matchResult: MatchResult }[] = [
      { item: anchor, matchResult: { isMatch: true, confidence: 100, matchedAttributes: ['self'], mismatchedAttributes: [], explanation: 'Anchor product' } },
    ];

    // Find matches from OTHER platforms
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidates[j].grouped) continue;
      // Only match across different platforms
      if (candidates[j].product.platform === anchor.product.platform) continue;

      const matchResult = validateMatch(anchor.attributes, candidates[j].attributes);

      if (matchResult.isMatch && matchResult.confidence >= minConfidence) {
        candidates[j].grouped = true;
        cluster.push({ item: candidates[j], matchResult });
      }
    }

    // Only create a group if we have listings from 2+ platforms
    if (cluster.length >= 2) {
      const listings: GroupListing[] = cluster.map(({ item }) => {
        const trust = computeSellerTrust(item.product.vendor, item.product.platform);
        return {
          platform: item.product.platform,
          product: item.product,
          vendorName: trust.displayName,
          trustLevel: trust.trustLevel,
          trustScore: trust.trustScore,
          scamFlags: trust.scamFlags,
          attributes: item.attributes,
        };
      });

      // Sort by price ascending
      listings.sort((a, b) => a.product.price - b.product.price);

      const prices = listings.map(l => l.product.price);
      const lowestPrice = Math.min(...prices);
      const highestPrice = Math.max(...prices);

      // Compute average confidence across all match pairs
      const matchConfidences = cluster.slice(1).map(c => c.matchResult.confidence);
      const avgConfidence = matchConfidences.length > 0
        ? Math.round(matchConfidences.reduce((a, b) => a + b, 0) / matchConfidences.length)
        : 0;

      // Use the most descriptive title
      const bestTitle = pickBestTitle(listings);

      // Check for condition mixing
      const conditions = new Set(listings.map(l => l.attributes.condition).filter(c => c !== 'UNKNOWN'));
      let conditionWarning: string | undefined;
      if (conditions.size > 1) {
        conditionWarning = `Comparing different conditions: ${[...conditions].join(', ').replace(/_/g, ' ')}. Prices may vary due to condition.`;
      }

      // Validate savings — only show if confidence is high enough
      const savings = avgConfidence >= 60 ? highestPrice - lowestPrice : 0;

      groups.push({
        groupId: `grp-${groups.length + 1}`,
        name: bestTitle,
        listings,
        lowestPrice,
        highestPrice,
        cheapestPlatform: listings[0].platform,
        savings,
        platformCount: new Set(listings.map(l => l.platform)).size,
        matchConfidence: avgConfidence,
        matchExplanation: cluster[1]?.matchResult.explanation || '',
        matchedAttributes: cluster[1]?.matchResult.matchedAttributes || [],
        mismatchedAttributes: cluster[1]?.matchResult.mismatchedAttributes || [],
        attributes: {
          brand: anchor.attributes.brand,
          model: anchor.attributes.model,
          storage: anchor.attributes.storage,
          category: anchor.attributes.category,
          condition: anchor.attributes.condition,
        },
        conditionWarning,
      });
    } else {
      // Unmark — it's unmatched
      anchor.grouped = false;
    }
  }

  // Sort groups: highest confidence first, then by savings
  groups.sort((a, b) => {
    if (b.matchConfidence !== a.matchConfidence) return b.matchConfidence - a.matchConfidence;
    return b.savings - a.savings;
  });

  // Collect unmatched
  const unmatched = candidates.filter(c => !c.grouped).map(c => c.product);

  const totalGrouped = groups.reduce((sum, g) => sum + g.listings.length, 0);
  const avgConfidence = groups.length > 0
    ? Math.round(groups.reduce((sum, g) => sum + g.matchConfidence, 0) / groups.length)
    : 0;

  return {
    groups,
    unmatched,
    filteredAsAccessories,
    stats: {
      totalInput: products.length,
      totalGrouped,
      totalUnmatched: unmatched.length,
      totalFilteredAccessories: filteredAsAccessories.length,
      groupCount: groups.length,
      avgConfidence,
    },
  };
}

// ─── Title Selection ────────────────────────────────────

function pickBestTitle(listings: GroupListing[]): string {
  // Prefer titles from Jumia/Konga (more structured) over Jiji (user-generated)
  const platformPriority: Record<string, number> = { JUMIA: 3, KONGA: 2, JIJI: 1 };

  // Score each title by: platform priority + length (longer = more descriptive, up to a point)
  let best = listings[0];
  let bestScore = 0;

  for (const l of listings) {
    const platformScore = platformPriority[l.platform] || 0;
    const lengthScore = Math.min(l.product.title.length / 100, 1); // Cap at 100 chars
    const score = platformScore + lengthScore;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }

  return best.product.title;
}
