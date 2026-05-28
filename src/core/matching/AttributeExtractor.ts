/**
 * AttributeExtractor — Rule-based structured attribute extraction from product titles.
 *
 * Parses Nigerian e-commerce product titles into structured fields:
 *   { brand, model, storage, ram, color, condition, category, isAccessory }
 *
 * This is deterministic, fast, free, and testable — no AI/LLM needed.
 */

export interface ProductAttributes {
  brand: string | null;
  model: string | null;
  storage: string | null;       // e.g. "128GB", "1TB"
  ram: string | null;            // e.g. "8GB"
  color: string | null;
  condition: 'NEW' | 'UK_USED' | 'FAIRLY_USED' | 'REFURBISHED' | 'OPEN_BOX' | 'UNKNOWN';
  category: ProductCategory;
  isAccessory: boolean;
  generation: string | null;     // e.g. "13", "15 Pro Max", "Series 9"
  variant: string | null;        // e.g. "Digital Edition", "Ultra", "Pro"
  confidence: number;            // 0–100 — how confident we are in the extraction
  normalizedSignature: string;   // canonical form for matching
}

export type ProductCategory =
  | 'PHONE'
  | 'TABLET'
  | 'LAPTOP'
  | 'DESKTOP'
  | 'TV'
  | 'GAMING_CONSOLE'
  | 'AUDIO'
  | 'WEARABLE'
  | 'CAMERA'
  | 'APPLIANCE'
  | 'PHONE_ACCESSORY'
  | 'LAPTOP_ACCESSORY'
  | 'GAMING_ACCESSORY'
  | 'GENERAL_ACCESSORY'
  | 'FASHION'
  | 'OTHER';

// ─── Brand detection ─────────────────────────────────────

const BRAND_MAP: Record<string, string> = {
  apple: 'Apple', iphone: 'Apple', ipad: 'Apple', macbook: 'Apple', airpods: 'Apple', 'apple watch': 'Apple',
  samsung: 'Samsung', galaxy: 'Samsung',
  infinix: 'Infinix',
  tecno: 'Tecno',
  itel: 'Itel',
  xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi',
  oppo: 'OPPO',
  vivo: 'Vivo',
  nokia: 'Nokia',
  huawei: 'Huawei',
  google: 'Google', pixel: 'Google',
  oneplus: 'OnePlus',
  realme: 'Realme',
  sony: 'Sony', playstation: 'Sony', ps5: 'Sony', ps4: 'Sony',
  microsoft: 'Microsoft', xbox: 'Microsoft', surface: 'Microsoft',
  nintendo: 'Nintendo',
  lg: 'LG',
  hp: 'HP',
  dell: 'Dell',
  lenovo: 'Lenovo', thinkpad: 'Lenovo', ideapad: 'Lenovo',
  asus: 'ASUS',
  acer: 'Acer',
  msi: 'MSI',
  jbl: 'JBL',
  bose: 'Bose',
  oraimo: 'Oraimo',
  anker: 'Anker',
  hisense: 'Hisense',
  haier: 'Haier',
  binatone: 'Binatone',
  tcl: 'TCL',
  'nothing': 'Nothing',
};

// ─── Accessory keywords ─────────────────────────────────

const ACCESSORY_KEYWORDS = [
  'case', 'cover', 'pouch', 'sleeve', 'skin', 'bumper', 'flip cover',
  'screen protector', 'tempered glass', 'glass film', 'protective film',
  'charger', 'charging cable', 'usb cable', 'lightning cable', 'type-c cable',
  'adapter', 'power bank', 'power adapter', 'wall charger',
  'earphone', 'headphone', 'headset', 'earbud',
  'holder', 'stand', 'mount', 'ring holder', 'grip', 'strap', 'wristband',
  'stylus', 'pen', 'sticker', 'decal', 'wrap',
  'sim tray', 'repair kit', 'replacement', 'spare part',
  'back glass', 'lcd screen', 'digitizer', 'flex cable',
  'keyboard cover', 'laptop bag', 'laptop sleeve', 'laptop stand',
  'mouse pad', 'webcam', 'usb hub', 'docking station',
  'controller grip', 'console skin', 'thumb grip',
  'memory card', 'sd card', 'flash drive', 'usb drive',
  'screen film', 'privacy screen',
];

// Accessory patterns that definitively mark something as an accessory
const ACCESSORY_PATTERNS = [
  /\bcase\s+(for|compatible|fit)\b/i,
  /\bcover\s+(for|compatible|fit)\b/i,
  /\bfor\s+(iphone|samsung|galaxy|infinix|tecno|ipad|macbook|ps[45]|xbox|nintendo)/i,
  /\bcompatible\s+with\b/i,
  /\bscreen\s*protector\b/i,
  /\btempered\s*glass\b/i,
  /\bcharger\s+(for|compatible)\b/i,
  /\breplacement\s+(screen|battery|back|lcd|digitizer)/i,
];

// ─── Condition detection ─────────────────────────────────

const CONDITION_MAP: [RegExp, ProductAttributes['condition']][] = [
  [/\b(brand\s*new|factory\s*sealed|sealed|bnew|new\s+in\s+box|unopened)\b/i, 'NEW'],
  [/\b(uk\s*used|tokunbo|london\s*used|foreign\s*used|ex[\s-]?uk|us\s*used|canada\s*used|european\s*used|grade\s*a\s*used)\b/i, 'UK_USED'],
  [/\b(fairly\s*used|nigerian?\s*used|naija\s*used|locally\s*used|clean\s*used|neat\s*used|working\s*perfectly|pre[\s-]?owned)\b/i, 'FAIRLY_USED'],
  [/\b(refurbished|refurb|renewed|reconditioned)\b/i, 'REFURBISHED'],
  [/\b(open\s*box|demo\s*unit|display\s*unit|unboxed)\b/i, 'OPEN_BOX'],
];

// ─── Color detection ─────────────────────────────────────

const COLORS = [
  'black', 'white', 'blue', 'green', 'red', 'gold', 'silver', 'grey', 'gray',
  'purple', 'pink', 'yellow', 'orange', 'rose gold', 'space gray', 'space grey',
  'midnight', 'starlight', 'sierra blue', 'alpine green', 'deep purple',
  'natural titanium', 'blue titanium', 'white titanium', 'black titanium', 'desert titanium',
  'cream', 'graphite', 'pacific blue', 'product red', 'coral', 'lavender',
  'phantom black', 'phantom white', 'burgundy', 'mint', 'ice blue', 'mystic bronze',
  'emerald', 'sapphire', 'ruby', 'onyx', 'pearl', 'champagne',
];

// ─── Category classification rules ──────────────────────

interface CategoryRule {
  category: ProductCategory;
  patterns: RegExp[];
  accessoryCategory?: ProductCategory;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'PHONE',
    patterns: [
      /\b(iphone|galaxy\s*[as]\d|galaxy\s*s\d|galaxy\s*z|galaxy\s*note|redmi\s*(note)?\s*\d|poco\s*[a-z]\d|pixel\s*\d|infinix\s*(hot|note|smart|zero)|tecno\s*(spark|camon|phantom|pop|pova)|itel\s*(a|p|s)\d|nokia\s*[gc]?\d|huawei\s*(p|mate|nova)\d|oneplus\s*\d|realme\s*\d|oppo\s*(a|reno|find)|vivo\s*[a-z]\d|nothing\s*phone)\b/i,
      /\b(smartphone|mobile\s*phone|android\s*phone|cell\s*phone|dual\s*sim\s*phone)\b/i,
    ],
    accessoryCategory: 'PHONE_ACCESSORY',
  },
  {
    category: 'TABLET',
    patterns: [
      /\b(ipad|galaxy\s*tab|surface\s*(pro|go)|mediapad|matepad|tab\s*[as]\d|fire\s*hd|kindle)\b/i,
    ],
  },
  {
    category: 'LAPTOP',
    patterns: [
      /\b(macbook|thinkpad|ideapad|vivobook|zenbook|elitebook|probook|pavilion|envy|latitude|inspiron|xps|surface\s*laptop|chromebook|swift|aspire|predator|rog\s*(strix|zephyrus)|legion|yoga)\b/i,
      /\b(laptop|notebook)\b/i,
    ],
    accessoryCategory: 'LAPTOP_ACCESSORY',
  },
  {
    category: 'GAMING_CONSOLE',
    patterns: [
      /\b(playstation|ps[45]|xbox\s*(series|one)|nintendo\s*(switch|wii)|steam\s*deck)\b/i,
    ],
    accessoryCategory: 'GAMING_ACCESSORY',
  },
  {
    category: 'TV',
    patterns: [
      /\b(smart\s*tv|led\s*tv|oled\s*tv|qled|uhd\s*tv|4k\s*tv|television|\d{2,3}\s*inch(?:es)?\s*tv)\b/i,
      /\b(roku|fire\s*tv\s*stick|chromecast|apple\s*tv)\b/i,
    ],
  },
  {
    category: 'AUDIO',
    patterns: [
      /\b(airpods|galaxy\s*buds|freepods|freebuds|earbuds|bluetooth\s*(speaker|headphone|earphone)|soundbar|home\s*theater|soundcore|jbl\s*(flip|charge|go|xtreme|tune|live)|bose\s*(qc|quietcomfort|soundlink))\b/i,
    ],
  },
  {
    category: 'WEARABLE',
    patterns: [
      /\b(apple\s*watch|galaxy\s*watch|fitbit|amazfit|mi\s*band|smart\s*watch|smartwatch|smart\s*band)\b/i,
    ],
  },
];

// ─── Storage extraction ─────────────────────────────────

const STORAGE_PATTERN = /\b(\d+)\s*(gb|tb)\b(?!\s*ram)/i;
const RAM_PATTERN = /\b(\d+)\s*gb\s*ram\b/i;
const RAM_SLASH_PATTERN = /\b(\d+)\s*\/\s*(\d+)\s*gb\b/i; // "8/256GB" format

// ─── Model extraction patterns ──────────────────────────

const MODEL_PATTERNS: { brand: string; pattern: RegExp; modelGroup: number }[] = [
  // Apple
  { brand: 'Apple', pattern: /\b(iphone\s*\d+(?:\s*(?:pro\s*max|pro|plus|mini|se))?)/i, modelGroup: 1 },
  { brand: 'Apple', pattern: /\b(ipad\s*(?:pro|air|mini)?\s*(?:\d+(?:th|rd|nd|st)\s*gen(?:eration)?|\d{4})?)/i, modelGroup: 1 },
  { brand: 'Apple', pattern: /\b(macbook\s*(?:pro|air)\s*(?:\d+(?:\.\d+)?\s*(?:inch|")|\d{4}|m[1-4](?:\s*(?:pro|max|ultra))?)?)/i, modelGroup: 1 },
  { brand: 'Apple', pattern: /\b(airpods\s*(?:pro|max)?\s*(?:\d+(?:st|nd|rd|th)\s*gen(?:eration)?|\d)?)/i, modelGroup: 1 },
  { brand: 'Apple', pattern: /\b(apple\s*watch\s*(?:ultra|se)?\s*(?:series\s*\d+|\d)?)/i, modelGroup: 1 },
  // Samsung
  { brand: 'Samsung', pattern: /\b(galaxy\s*(?:s|a|m|f|z\s*(?:fold|flip))\s*\d+(?:\s*(?:ultra|plus|\+|fe|lite|5g))*)/i, modelGroup: 1 },
  { brand: 'Samsung', pattern: /\b(galaxy\s*tab\s*(?:s|a)\d+(?:\s*(?:ultra|plus|\+|fe|lite))*)/i, modelGroup: 1 },
  { brand: 'Samsung', pattern: /\b(galaxy\s*buds\s*(?:\d+)?(?:\s*(?:pro|fe|live|plus))?)/i, modelGroup: 1 },
  { brand: 'Samsung', pattern: /\b(galaxy\s*watch\s*(?:\d+)?(?:\s*(?:ultra|classic))?)/i, modelGroup: 1 },
  // Infinix
  { brand: 'Infinix', pattern: /\b(infinix\s*(?:hot|note|smart|zero|gt)\s*\d+(?:\s*(?:pro|play|i|x|nfc|5g))*)/i, modelGroup: 1 },
  // Tecno
  { brand: 'Tecno', pattern: /\b(tecno\s*(?:spark|camon|phantom|pop|pova)\s*\d+(?:\s*(?:pro|go|premier|5g|plus))*)/i, modelGroup: 1 },
  // Xiaomi / Redmi / Poco
  { brand: 'Xiaomi', pattern: /\b(redmi\s*(?:note)?\s*\d+(?:\s*(?:pro|plus|s|c|5g))*)/i, modelGroup: 1 },
  { brand: 'Xiaomi', pattern: /\b(poco\s*[a-z]\d+(?:\s*(?:pro|plus|5g))*)/i, modelGroup: 1 },
  // Sony
  { brand: 'Sony', pattern: /\b(playstation\s*5|ps5)\s*(digital\s*edition|disc\s*edition|slim|pro)?/i, modelGroup: 0 },
  { brand: 'Sony', pattern: /\b(playstation\s*4|ps4)\s*(slim|pro)?/i, modelGroup: 0 },
  // Microsoft
  { brand: 'Microsoft', pattern: /\b(xbox\s*series\s*[xs])/i, modelGroup: 1 },
  // Nintendo
  { brand: 'Nintendo', pattern: /\b(nintendo\s*switch\s*(?:oled|lite)?)/i, modelGroup: 1 },
  // Google
  { brand: 'Google', pattern: /\b(pixel\s*\d+(?:\s*(?:pro|a|xl))?)/i, modelGroup: 1 },
  // Generic laptop patterns
  { brand: '', pattern: /\b(thinkpad\s*[a-z]\d+(?:\s*gen\s*\d+)?)/i, modelGroup: 1 },
  { brand: '', pattern: /\b(ideapad\s*(?:slim|flex)?\s*\d+)/i, modelGroup: 1 },
];

// ─── Main extraction function ───────────────────────────

export function extractAttributes(title: string): ProductAttributes {
  const original = title;
  const lower = title.toLowerCase().trim();
  let confidence = 0;

  // 1. Detect if it's an accessory first
  const isAccessory = detectAccessory(lower);
  if (isAccessory) confidence += 10;

  // 2. Extract brand
  const brand = extractBrand(lower);
  if (brand) confidence += 20;

  // 3. Classify category
  const category = classifyCategory(lower, isAccessory, brand);
  if (category !== 'OTHER') confidence += 15;

  // 4. Extract model
  const model = extractModel(lower, brand);
  if (model) confidence += 25;

  // 5. Extract storage
  const storage = extractStorage(lower);
  if (storage) confidence += 15;

  // 6. Extract RAM
  const ram = extractRAM(lower);
  if (ram) confidence += 5;

  // 7. Extract color
  const color = extractColor(lower);

  // 8. Detect condition
  const condition = detectCondition(lower);
  if (condition !== 'UNKNOWN') confidence += 10;

  // 9. Extract variant/generation info
  const variant = extractVariant(lower, model);

  // Cap confidence at 100
  confidence = Math.min(100, confidence);

  // Build normalized signature for matching
  const normalizedSignature = buildSignature(brand, model, storage, category);

  return {
    brand,
    model,
    storage,
    ram,
    color,
    condition,
    category,
    isAccessory,
    generation: null, // derived from model
    variant,
    confidence,
    normalizedSignature,
  };
}

// ─── Sub-extractors ─────────────────────────────────────

function extractBrand(lower: string): string | null {
  // Try multi-word brands first (more specific)
  for (const [keyword, brand] of Object.entries(BRAND_MAP)) {
    if (keyword.includes(' ')) {
      if (lower.includes(keyword)) return brand;
    }
  }
  // Then single-word
  for (const [keyword, brand] of Object.entries(BRAND_MAP)) {
    if (!keyword.includes(' ')) {
      // Word boundary match
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lower)) return brand;
    }
  }
  return null;
}

function detectAccessory(lower: string): boolean {
  // Pattern-based detection first (most reliable)
  for (const pattern of ACCESSORY_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  // Keyword-based detection
  for (const kw of ACCESSORY_KEYWORDS) {
    if (lower.includes(kw)) {
      // Check it's not just part of the main product name
      // e.g. "iPhone 15 Pro Max" should NOT be flagged because of "charger" if "charger" isn't in the title
      return true;
    }
  }

  // Price-based heuristic: very cheap items for expensive product names are likely accessories
  // (This would require price context — handled at the grouping level)

  return false;
}

function classifyCategory(lower: string, isAccessory: boolean, brand: string | null): ProductCategory {
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) {
        if (isAccessory && rule.accessoryCategory) {
          return rule.accessoryCategory;
        }
        return isAccessory ? 'GENERAL_ACCESSORY' : rule.category;
      }
    }
  }

  // Fallback heuristics
  if (isAccessory) return 'GENERAL_ACCESSORY';
  if (/\b(dress|shirt|trouser|shoe|sneaker|gown|blouse|jean|skirt|jacket|hoodie|t-?shirt)\b/i.test(lower)) return 'FASHION';

  return 'OTHER';
}

function extractModel(lower: string, brand: string | null): string | null {
  for (const mp of MODEL_PATTERNS) {
    if (mp.brand && brand && mp.brand !== brand) continue;

    const match = lower.match(mp.pattern);
    if (match) {
      if (mp.modelGroup === 0) {
        // Full match (e.g. PS5 Digital Edition)
        return match[0].trim()
          .replace(/\s+/g, ' ')
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
      const raw = (match[mp.modelGroup] || match[0]).trim();
      return raw
        .replace(/\s+/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return null;
}

function extractStorage(lower: string): string | null {
  // Try "8/256GB" format first → storage is the larger number
  const slashMatch = lower.match(RAM_SLASH_PATTERN);
  if (slashMatch) {
    const a = parseInt(slashMatch[1]);
    const b = parseInt(slashMatch[2]);
    // Larger number is storage, smaller is RAM (usually)
    const storage = Math.max(a, b);
    return `${storage}GB`;
  }

  // Standard pattern
  const match = lower.match(STORAGE_PATTERN);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2].toUpperCase();
    // Sanity check: RAM values are typically 2-32GB, storage is 32GB+
    if (unit === 'TB' || num >= 32) {
      return `${num}${unit}`;
    }
    // Could be RAM, not storage — skip if small
    if (num <= 16) return null;
    return `${num}${unit}`;
  }
  return null;
}

function extractRAM(lower: string): string | null {
  const match = lower.match(RAM_PATTERN);
  if (match) return `${match[1]}GB`;

  // "8/256GB" format — smaller number is RAM
  const slashMatch = lower.match(RAM_SLASH_PATTERN);
  if (slashMatch) {
    const a = parseInt(slashMatch[1]);
    const b = parseInt(slashMatch[2]);
    const ram = Math.min(a, b);
    if (ram <= 32) return `${ram}GB`;
  }

  return null;
}

function extractColor(lower: string): string | null {
  // Sort by length descending so "space gray" matches before "gray"
  const sorted = [...COLORS].sort((a, b) => b.length - a.length);
  for (const color of sorted) {
    if (lower.includes(color)) {
      return color.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return null;
}

function detectCondition(lower: string): ProductAttributes['condition'] {
  for (const [regex, condition] of CONDITION_MAP) {
    if (regex.test(lower)) return condition;
  }
  return 'UNKNOWN';
}

function extractVariant(lower: string, model: string | null): string | null {
  if (!model) return null;

  // PS5 variants
  if (/ps5|playstation\s*5/i.test(lower)) {
    if (/digital/i.test(lower)) return 'Digital Edition';
    if (/disc/i.test(lower)) return 'Disc Edition';
    if (/slim/i.test(lower)) return 'Slim';
    if (/\bpro\b/i.test(lower)) return 'Pro';
  }

  return null;
}

function buildSignature(brand: string | null, model: string | null, storage: string | null, category: ProductCategory): string {
  const parts: string[] = [];
  if (brand) parts.push(brand.toLowerCase());
  if (model) parts.push(model.toLowerCase());
  if (storage) parts.push(storage.toLowerCase());
  // Category is implicit — matching will gate on it
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Match validation ───────────────────────────────────

export interface MatchResult {
  isMatch: boolean;
  confidence: number;       // 0–100
  matchedAttributes: string[];
  mismatchedAttributes: string[];
  explanation: string;
}

/**
 * Validate whether two products should be compared.
 * Uses hard gates (category, model, storage) and soft scoring (color, condition).
 */
export function validateMatch(a: ProductAttributes, b: ProductAttributes): MatchResult {
  const matched: string[] = [];
  const mismatched: string[] = [];
  let score = 0;

  // ── HARD GATES — any of these failing means NO MATCH ──

  // Gate 1: Category must match exactly
  if (a.category !== b.category) {
    return {
      isMatch: false,
      confidence: 0,
      matchedAttributes: matched,
      mismatchedAttributes: ['category'],
      explanation: `Category mismatch: ${a.category} vs ${b.category}`,
    };
  }
  matched.push('category');
  score += 20;

  // Gate 2: Accessories never match non-accessories
  if (a.isAccessory !== b.isAccessory) {
    return {
      isMatch: false,
      confidence: 0,
      matchedAttributes: matched,
      mismatchedAttributes: ['product_type'],
      explanation: 'Cannot compare accessory with main device',
    };
  }

  // Gate 3: Brand must match (if both detected)
  if (a.brand && b.brand && a.brand !== b.brand) {
    return {
      isMatch: false,
      confidence: 0,
      matchedAttributes: matched,
      mismatchedAttributes: ['brand'],
      explanation: `Brand mismatch: ${a.brand} vs ${b.brand}`,
    };
  }
  if (a.brand && b.brand && a.brand === b.brand) {
    matched.push('brand');
    score += 20;
  }

  // Gate 4: Model must match (if both detected)
  if (a.model && b.model) {
    const modelSim = normalizedModelSimilarity(a.model, b.model);
    if (modelSim < 0.8) {
      return {
        isMatch: false,
        confidence: 0,
        matchedAttributes: matched,
        mismatchedAttributes: ['model'],
        explanation: `Model mismatch: ${a.model} vs ${b.model}`,
      };
    }
    matched.push('model');
    score += 25;
  }

  // Gate 5: Storage must match (if both detected)
  if (a.storage && b.storage) {
    if (a.storage.toLowerCase() !== b.storage.toLowerCase()) {
      return {
        isMatch: false,
        confidence: 0,
        matchedAttributes: matched,
        mismatchedAttributes: ['storage'],
        explanation: `Storage mismatch: ${a.storage} vs ${b.storage}`,
      };
    }
    matched.push('storage');
    score += 15;
  }

  // ── SOFT SCORING — these add confidence but don't block ──

  // RAM match (bonus)
  if (a.ram && b.ram) {
    if (a.ram.toLowerCase() === b.ram.toLowerCase()) {
      matched.push('ram');
      score += 5;
    } else {
      mismatched.push('ram');
      // Don't penalize heavily — RAM is often not in listing titles
    }
  }

  // Condition match (informational — same condition = more comparable prices)
  if (a.condition !== 'UNKNOWN' && b.condition !== 'UNKNOWN') {
    if (a.condition === b.condition) {
      matched.push('condition');
      score += 5;
    } else {
      mismatched.push('condition');
      // Different conditions are OK to compare but should be flagged
    }
  }

  // Color — explicitly does NOT affect matching
  if (a.color && b.color) {
    if (a.color.toLowerCase() === b.color.toLowerCase()) {
      matched.push('color');
      score += 2; // Tiny bonus, never a penalty
    }
    // Different colors: no penalty at all
  }

  // Variant match for consoles
  if (a.variant && b.variant) {
    if (a.variant.toLowerCase() !== b.variant.toLowerCase()) {
      return {
        isMatch: false,
        confidence: 0,
        matchedAttributes: matched,
        mismatchedAttributes: ['variant'],
        explanation: `Variant mismatch: ${a.variant} vs ${b.variant}`,
      };
    }
    matched.push('variant');
    score += 10;
  }

  // Minimum confidence threshold
  const confidence = Math.min(100, score);
  const isMatch = confidence >= 40; // Need at least category + brand + model

  return {
    isMatch,
    confidence,
    matchedAttributes: matched,
    mismatchedAttributes: mismatched,
    explanation: isMatch
      ? `Matched on: ${matched.join(', ')} (${confidence}% confidence)`
      : `Insufficient match confidence: ${confidence}% (matched: ${matched.join(', ')})`,
  };
}

// ─── Helpers ────────────────────────────────────────────

function normalizedModelSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (na === nb) return 1;

  // Check if one contains the other (e.g. "iPhone 15" vs "iPhone 15 Pro Max" should NOT match)
  // But "Iphone 15 Pro Max" vs "iPhone 15 Pro Max" should match
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');

  // Exact word-by-word match
  let matchCount = 0;
  const maxWords = Math.max(wordsA.length, wordsB.length);
  const minWords = Math.min(wordsA.length, wordsB.length);

  for (let i = 0; i < minWords; i++) {
    if (wordsA[i] === wordsB[i]) matchCount++;
    else break; // Stop at first mismatch for ordered comparison
  }

  // If word counts differ significantly, it's probably a different model
  if (Math.abs(wordsA.length - wordsB.length) > 1) {
    return matchCount / maxWords;
  }

  return matchCount / maxWords;
}

/**
 * Price-based accessory detection heuristic.
 * If a product has a known main-device category (PHONE, LAPTOP, etc.)
 * but its price is below the threshold, it's likely an accessory mislabeled.
 */
export function isPriceSuspiciousForCategory(price: number, category: ProductCategory): boolean {
  const MIN_PRICES: Partial<Record<ProductCategory, number>> = {
    PHONE: 15000,         // Cheapest real phones in Nigeria
    LAPTOP: 80000,
    TABLET: 30000,
    TV: 30000,
    GAMING_CONSOLE: 80000,
    WEARABLE: 10000,
  };

  const minPrice = MIN_PRICES[category];
  if (minPrice && price < minPrice) return true;
  return false;
}
