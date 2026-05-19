import {
  classifyCondition,
  normalizeProductName,
  extractBrand,
  slugify,
  levenshteinDistance,
  similarityScore,
  trigramSimilarity,
  formatNaira,
  parseNairaPrice,
} from '../../src/shared/utils';

describe('classifyCondition', () => {
  it('detects NEW condition', () => {
    expect(classifyCondition('Brand New Samsung Galaxy')).toBe('NEW');
    expect(classifyCondition('Sealed in Box iPhone')).toBe('NEW');
  });

  it('detects UK_USED / Tokunbo', () => {
    expect(classifyCondition('Tokunbo iPhone 12')).toBe('UK_USED');
    expect(classifyCondition('UK Used Laptop HP')).toBe('UK_USED');
    expect(classifyCondition('London Used MacBook')).toBe('UK_USED');
  });

  it('detects FAIRLY_USED', () => {
    expect(classifyCondition('Fairly Used Samsung Phone')).toBe('FAIRLY_USED');
    expect(classifyCondition('Neat Used Tecno Spark')).toBe('FAIRLY_USED');
  });

  it('detects REFURBISHED', () => {
    expect(classifyCondition('Refurbished iPhone 11')).toBe('REFURBISHED');
  });

  it('returns UNKNOWN for unclassified', () => {
    expect(classifyCondition('Samsung Galaxy A15')).toBe('UNKNOWN');
  });
});

describe('extractBrand', () => {
  it('extracts known Nigerian-market brands', () => {
    expect(extractBrand('Infinix Hot 40i')).toBe('Infinix');
    expect(extractBrand('Tecno Spark 20 Pro+')).toBe('Tecno');
    expect(extractBrand('Oraimo FreePods 4')).toBe('Oraimo');
    expect(extractBrand('Itel P40+ Dual SIM')).toBe('Itel');
  });

  it('extracts global brands', () => {
    expect(extractBrand('Samsung Galaxy A15')).toBe('Samsung');
    expect(extractBrand('Apple iPhone 15 Pro')).toBe('Apple');
    expect(extractBrand('HP Laptop 15s')).toBe('HP');
  });

  it('returns null for unrecognized brands', () => {
    expect(extractBrand('Generic Phone 2024')).toBeNull();
  });
});

describe('slugify', () => {
  it('creates URL-safe slugs', () => {
    expect(slugify('Samsung Galaxy A15')).toBe('samsung-galaxy-a15');
    expect(slugify('Tecno Spark 20 Pro+')).toBe('tecno-spark-20-pro');
    expect(slugify('iPhone 15 (128GB)')).toBe('iphone-15-128gb');
  });
});

describe('normalizeProductName', () => {
  it('normalizes and preserves brand casing', () => {
    const result = normalizeProductName('SAMSUNG galaxy A15 - 128gb ROM');
    expect(result).toContain('Samsung');
    expect(result).toContain('a15');
    expect(result.toLowerCase()).toContain('128');
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('calculates correct edit distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('samsung', 'sumsung')).toBe(1);
  });
});

describe('similarityScore', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityScore('hello', 'hello')).toBe(1);
  });

  it('returns high score for similar strings', () => {
    expect(similarityScore('Samsung Galaxy A15', 'Samsung Galaxy A15 128GB')).toBeGreaterThan(0.7);
  });
});

describe('trigramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(trigramSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns high score for similar strings', () => {
    expect(trigramSimilarity('Samsung Galaxy', 'Samsung Galxy')).toBeGreaterThan(0.5);
  });
});

describe('formatNaira', () => {
  it('formats numbers as Naira', () => {
    expect(formatNaira(115000)).toContain('115');
  });
});

describe('parseNairaPrice', () => {
  it('parses Naira price strings', () => {
    expect(parseNairaPrice('₦ 115,000')).toBe(115000);
    expect(parseNairaPrice('NGN 45,500.50')).toBe(45500.50);
    expect(parseNairaPrice('12000')).toBe(12000);
  });

  it('returns null for invalid strings', () => {
    expect(parseNairaPrice('free')).toBeNull();
    expect(parseNairaPrice('')).toBeNull();
  });
});
