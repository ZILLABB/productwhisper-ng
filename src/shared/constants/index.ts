export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const NIGERIAN_CONDITION_KEYWORDS: Record<string, string[]> = {
  NEW: ['brand new', 'sealed', 'bnew', 'new in box', 'factory sealed', 'unopened', 'new arrival', 'latest', 'original new'],
  UK_USED: ['uk used', 'tokunbo', 'london used', 'foreign used', 'ex-uk', 'grade a used', 'us used', 'canada used', 'european used', 'grade a', 'grade b'],
  FAIRLY_USED: ['fairly used', 'nigerian used', 'naija used', 'locally used', 'clean used', 'neat used', 'working perfectly', 'pre-owned', 'pre owned', 'used'],
  REFURBISHED: ['refurbished', 'refurb', 'first copy', 'grade a copy', 'renewed', 'reconditioned', 'certified pre-owned'],
  OPEN_BOX: ['open box', 'demo unit', 'display unit', 'unboxed'],
};

/**
 * Platforms where listings without condition keywords should default to NEW
 * (official marketplace retailers typically sell new items).
 */
export const PLATFORMS_DEFAULT_NEW = ['JUMIA', 'KONGA'];

export const PLATFORM_BASE_URLS = {
  JUMIA: 'https://www.jumia.com.ng',
  KONGA: 'https://www.konga.com',
  JIJI: 'https://jiji.ng',
  NAIRALAND: 'https://www.nairaland.com',
  YOUTUBE: 'https://www.youtube.com',
} as const;

export const SCRAPER_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
];

export const NIGERIAN_PRODUCT_CATEGORIES = [
  'Phones & Tablets',
  'Computing',
  'Electronics',
  'Fashion',
  'Home & Office',
  'Health & Beauty',
  'Baby Products',
  'Gaming',
  'Automobile',
  'Sporting Goods',
  'Groceries',
  'Other',
] as const;

export const QUEUE_NAMES = {
  SCRAPING: 'scraping',
  SENTIMENT: 'sentiment',
  PRICE_UPDATE: 'price-update',
  TRUST_COMPUTE: 'trust-compute',
} as const;

export const CACHE_PREFIXES = {
  SEARCH: 'search',
  PRODUCT: 'product',
  PRICE: 'price',
  SENTIMENT: 'sentiment',
  TRUST: 'trust',
  TRENDING: 'trending',
  LISTING: 'listing',
} as const;
