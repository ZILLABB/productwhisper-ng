import { classifyCondition, extractBrand, normalizeProductName } from '../../src/shared/utils';

describe('Product Classification Pipeline', () => {
  const testProducts = [
    { title: 'Brand New Infinix Hot 40i 128GB', expectedCondition: 'NEW', expectedBrand: 'Infinix' },
    { title: 'Tokunbo Samsung Galaxy S23 256GB', expectedCondition: 'UK_USED', expectedBrand: 'Samsung' },
    { title: 'Fairly Used Tecno Spark 20', expectedCondition: 'FAIRLY_USED', expectedBrand: 'Tecno' },
    { title: 'Refurbished Samsung Galaxy S23', expectedCondition: 'REFURBISHED', expectedBrand: 'Samsung' },
    { title: 'UK Used HP Laptop 15 Intel Core i5', expectedCondition: 'UK_USED', expectedBrand: 'HP' },
    { title: 'Oraimo FreePods 4 Wireless Earbuds', expectedCondition: 'UNKNOWN', expectedBrand: 'Oraimo' },
  ];

  testProducts.forEach(({ title, expectedCondition, expectedBrand }) => {
    it(`classifies "${title}" correctly`, () => {
      expect(classifyCondition(title)).toBe(expectedCondition);
      expect(extractBrand(title)).toBe(expectedBrand);
    });
  });
});

describe('Product Name Normalization', () => {
  it('normalizes variant names to comparable form', () => {
    const variants = [
      'Samsung Galaxy A15 - 128GB ROM - 6GB RAM',
      'SAMSUNG GALAXY A15 128GB/6GB',
      'samsung galaxy a15 (128gb)',
    ];

    const normalized = variants.map(normalizeProductName);
    const allContainKey = normalized.every((n) => {
      const lower = n.toLowerCase();
      return lower.includes('samsung') && lower.includes('galaxy') && lower.includes('a15');
    });
    expect(allContainKey).toBe(true);
  });
});

describe('Error Classes', () => {
  it('creates AppError with correct properties', () => {
    const { AppError } = require('../../src/shared/errors');
    const error = new AppError('Test error', 400, 'TEST_ERROR');
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TEST_ERROR');
    expect(error instanceof Error).toBe(true);
  });

  it('creates NotFoundError with 404 status', () => {
    const { NotFoundError } = require('../../src/shared/errors');
    const error = new NotFoundError('Product');
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('Product');
  });

  it('creates UnauthorizedError with 401 status', () => {
    const { UnauthorizedError } = require('../../src/shared/errors');
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
  });
});
