/**
 * AttributeExtractor — Rule-based structured attribute extraction from product titles.
 *
 * Parses Nigerian e-commerce product titles into structured fields:
 *   { brand, model, storage, ram, color, condition, category, isAccessory }
 *
 * This is deterministic, fast, free, and testable — no AI/LLM needed.
 */

export interface ProductSpecs {
  watts?: string;        // e.g. "500W", "3000W" — solar panels, generators, microwaves
  litres?: string;       // e.g. "20L", "200L" — microwaves, fridges, water tanks
  kwh?: string;          // e.g. "1kWh", "5kWh" — batteries, inverters
  ah?: string;           // e.g. "100Ah", "200Ah" — batteries
  btu?: string;          // e.g. "12000BTU" — air conditioners
  screenSize?: string;   // e.g. "55\"", "6.7\"" — TVs, phones
  weight?: string;       // e.g. "5kg", "20kg"
  voltage?: string;      // e.g. "12V", "24V", "48V"
}

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
  specs: ProductSpecs;           // physical specs (watts, litres, kWh, etc.)
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
  | 'STORAGE_DEVICE'
  | 'NETWORKING'
  | 'PRINTER'
  | 'APPLIANCE'
  | 'SOLAR_POWER'
  | 'GENERATOR'
  | 'AIR_CONDITIONER'
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
  // Appliance / power brands
  'thermocool': 'Thermocool', 'haier thermocool': 'Haier Thermocool',
  'scanfrost': 'Scanfrost', 'nexus': 'Nexus', 'polystar': 'Polystar',
  'midea': 'Midea', 'maxi': 'Maxi', 'panasonic': 'Panasonic',
  'sharp': 'Sharp', 'kenwood': 'Kenwood', 'philips': 'Philips',
  'bruhm': 'Bruhm', 'qasa': 'Qasa', 'century': 'Century',
  'tiger': 'Tiger', 'firman': 'Firman', 'sumec': 'Sumec',
  'elepaq': 'Elepaq', 'lutian': 'Lutian', 'honda': 'Honda',
  'yamaha': 'Yamaha', 'kemage': 'Kemage', 'senwei': 'Senwei',
  'luminous': 'Luminous', 'felicity': 'Felicity', 'must': 'Must',
  'bluegate': 'Bluegate', 'sukam': 'Sukam', 'genus': 'Genus',
  'mercury': 'Mercury', 'microtek': 'Microtek', 'power tank': 'Itel',
  'rubitec': 'Rubitec', 'kartel': 'Kartel',
  // Storage device brands
  'western digital': 'Western Digital', 'wd': 'Western Digital',
  'seagate': 'Seagate', 'toshiba': 'Toshiba',
  'kingston': 'Kingston', 'crucial': 'Crucial', 'sandisk': 'SanDisk',
  'transcend': 'Transcend', 'patriot': 'Patriot', 'pny': 'PNY',
  'intel': 'Intel', 'corsair': 'Corsair', 'addlink': 'Addlink',
  'hikvision': 'Hikvision', 'lexar': 'Lexar', 'teamgroup': 'TeamGroup',
  'team': 'TeamGroup', 'silicon power': 'Silicon Power', 'orico': 'Orico',
  // Networking brands
  'tp-link': 'TP-Link', 'tplink': 'TP-Link', 'tp link': 'TP-Link',
  'netgear': 'Netgear', 'cisco': 'Cisco', 'linksys': 'Linksys',
  'mikrotik': 'MikroTik', 'ubiquiti': 'Ubiquiti', 'dlink': 'D-Link', 'd-link': 'D-Link',
  'tenda': 'Tenda', 'mercusys': 'Mercusys', 'zyxel': 'Zyxel',
  // Printer brands
  'epson': 'Epson', 'canon': 'Canon', 'brother': 'Brother',
  'ricoh': 'Ricoh', 'xerox': 'Xerox', 'kyocera': 'Kyocera', 'konica': 'Konica Minolta',
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
  {
    category: 'SOLAR_POWER',
    patterns: [
      /\b(solar\s*(?:panel|generator|inverter|battery|system|kit|power\s*station|charge\s*controller|mppt|lithium\s*battery))\b/i,
      /\b(inverter\s*(?:battery|system)|power\s*station|lifepo4|lithium\s*(?:iron|battery)|ups\s*(?:battery|inverter))\b/i,
      /\b(pwm\s*controller|charge\s*controller|solar\s*light)\b/i,
    ],
  },
  {
    category: 'GENERATOR',
    patterns: [
      /\b(generator|gen\s*set|genset|petrol\s*generator|diesel\s*generator|silent\s*generator|portable\s*generator)\b/i,
      /\b(firman|sumec|elepaq|lutian|kemage|tiger\s*generator)\b/i,
    ],
  },
  {
    category: 'AIR_CONDITIONER',
    patterns: [
      /\b(air\s*condition(?:er|ing)?|split\s*(?:unit|ac)|window\s*ac|standing\s*ac|portable\s*ac|inverter\s*ac)\b/i,
      /\b(\d+\.?\d*\s*(?:hp|ton)\s*(?:split|ac|air))\b/i,
      /\b(\d{4,5}\s*btu)\b/i,
    ],
  },
  {
    category: 'STORAGE_DEVICE',
    patterns: [
      /\b(ssd|solid\s*state\s*drive|hdd|hard\s*(?:disk|drive)|nvme|m\.?2\s*(?:ssd|drive)?|sata\s*(?:ssd|drive|iii?)?|internal\s*(?:ssd|hard|drive)|external\s*(?:hard|drive|hdd|ssd))\b/i,
      /\b(wd\s*(?:blue|black|red|green|purple|gold|ultrastar)|barracuda|ironwolf|firecuda|skyhawk)\b/i,
      /\b(kingston\s*a\d{3,4}|crucial\s*(?:mx|bx|p\d)|samsung\s*(?:evo|pro|qvo)\s*\d{3})\b/i,
      /\b(portable\s*(?:ssd|hard\s*drive|hdd)|usb\s*(?:hard|drive|hdd))\b/i,
    ],
  },
  {
    category: 'NETWORKING',
    patterns: [
      /\b(router|wifi\s*router|wireless\s*router|modem|access\s*point|range\s*extender|wifi\s*extender|mesh\s*(?:router|system|wifi)|network\s*switch|ethernet\s*switch|poe\s*switch)\b/i,
      /\b(tp[\s-]?link|netgear|mikrotik|ubiquiti)\s+\w/i,
    ],
  },
  {
    category: 'PRINTER',
    patterns: [
      /\b(printer|inkjet|laserjet|laser\s*printer|all[\s-]?in[\s-]?one\s*printer|ink\s*tank|photocopier|copier|scanner\s*printer)\b/i,
    ],
  },
  {
    category: 'APPLIANCE',
    patterns: [
      /\b(microwave|blender|washing\s*machine|refrigerator|freezer|fridge|gas\s*cooker|electric\s*cooker|oven|toaster|iron(?:ing)?\s*(?:box|press)?|fan|standing\s*fan|ceiling\s*fan|water\s*heater|water\s*dispenser|rice\s*cooker|pressure\s*cooker|food\s*processor|juicer|kettle|vacuum\s*cleaner|dish\s*washer)\b/i,
      /\b(stabilizer|voltage\s*regulator|surge\s*protector|power\s*strip|extension\s*box)\b/i,
    ],
  },
];

// ─── Physical spec extraction ───────────────────────────

const SPEC_PATTERNS: { key: keyof ProductSpecs; pattern: RegExp; group: number; suffix: string }[] = [
  // Watts — "500W", "3000 watts", "500watts"
  { key: 'watts', pattern: /\b(\d{2,5})\s*(?:w(?:att)?s?)\b/i, group: 1, suffix: 'W' },
  // Litres — "20L", "200 litres", "20 liters", "32ltr"
  { key: 'litres', pattern: /\b(\d{1,4})\s*(?:l(?:itres?|iters?|tr?s?)?)\b/i, group: 1, suffix: 'L' },
  // kWh — "1kWh", "5 kwh", "1.5kwh"
  { key: 'kwh', pattern: /\b(\d+\.?\d*)\s*kwh\b/i, group: 1, suffix: 'kWh' },
  // Ah — "100Ah", "200 ah"
  { key: 'ah', pattern: /\b(\d{2,4})\s*ah\b/i, group: 1, suffix: 'Ah' },
  // BTU — "12000BTU", "18000 btu"
  { key: 'btu', pattern: /\b(\d{4,6})\s*btu\b/i, group: 1, suffix: 'BTU' },
  // Screen size — "55 inch", '6.7"', "65 inches"
  { key: 'screenSize', pattern: /\b(\d{1,3}(?:\.\d)?)\s*(?:inch(?:es)?|")\b/i, group: 1, suffix: '"' },
  // Weight — "5kg", "20 kg"
  { key: 'weight', pattern: /\b(\d{1,4}(?:\.\d)?)\s*kg\b/i, group: 1, suffix: 'kg' },
  // Voltage — "12V", "24V", "48V"
  { key: 'voltage', pattern: /\b(\d{1,3})\s*v(?:olt)?s?\b/i, group: 1, suffix: 'V' },
  // HP (horsepower) — for ACs: "1.5hp", "2 hp"
  // stored in watts as a normalized value (1hp ≈ 745W for display)
];

function extractSpecs(lower: string, category: ProductCategory): ProductSpecs {
  const specs: ProductSpecs = {};

  for (const { key, pattern, group, suffix } of SPEC_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      specs[key] = `${match[group]}${suffix}`;
    }
  }

  // HP for ACs — convert to watts equivalent for display
  const hpMatch = lower.match(/\b(\d+\.?\d*)\s*(?:hp|horse\s*power)\b/i);
  if (hpMatch && (category === 'AIR_CONDITIONER' || /ac|air\s*condition/i.test(lower))) {
    specs.watts = `${hpMatch[1]}HP`;
  }

  return specs;
}

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
  // Western Digital storage — "WD Blue", "Western Digital WD Blue 3D NAND"
  { brand: 'Western Digital', pattern: /\b(?:wd|western\s*digital)\s*(?:wd\s*)?(blue|black|red|green|purple|gold|ultrastar)(?:\s*(?:3d\s*nand|sa\d{3}|sn\d{3,4}|plus))?/i, modelGroup: 0 },
  { brand: 'Western Digital', pattern: /\b(my\s*(?:passport|book|cloud)\s*(?:ultra|ssd|go|duo|essential)?)/i, modelGroup: 1 },
  // Seagate storage
  { brand: 'Seagate', pattern: /\b(barracuda|ironwolf|firecuda|skyhawk|exos|one\s*touch|expansion|backup\s*plus)(?:\s*(?:pro|compute|nas|vn\d+))?/i, modelGroup: 0 },
  // Samsung storage
  { brand: 'Samsung', pattern: /\b(samsung\s*(?:\d{3}\s*)?(?:evo|pro|qvo)\s*(?:plus)?\s*\d{0,4})/i, modelGroup: 1 },
  { brand: 'Samsung', pattern: /\b(samsung\s*t\d)\b/i, modelGroup: 1 },
  // Kingston storage
  { brand: 'Kingston', pattern: /\b(kingston\s*(?:a\d{3,4}|nv\d|fury|kc\d{3,4}|datatraveler))/i, modelGroup: 1 },
  // Crucial storage
  { brand: 'Crucial', pattern: /\b(crucial\s*(?:mx\d{3}|bx\d{3}|p\d|t\d{3}|x\d))/i, modelGroup: 1 },
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

  // 10. Extract physical specs (watts, litres, kWh, etc.)
  const specs = extractSpecs(lower, category);
  if (Object.keys(specs).length > 0) confidence += 10;

  // Cap confidence at 100
  confidence = Math.min(100, confidence);

  // Build normalized signature for matching
  const normalizedSignature = buildSignature(brand, model, storage, category, specs);

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
    specs,
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

function buildSignature(brand: string | null, model: string | null, storage: string | null, category: ProductCategory, specs?: ProductSpecs): string {
  const parts: string[] = [];
  if (brand) parts.push(brand.toLowerCase());
  if (model) parts.push(model.toLowerCase());
  if (storage) parts.push(storage.toLowerCase());
  // Include key specs in signature for non-electronics (appliances, solar, etc.)
  if (specs) {
    if (specs.watts) parts.push(specs.watts.toLowerCase());
    if (specs.litres) parts.push(specs.litres.toLowerCase());
    if (specs.kwh) parts.push(specs.kwh.toLowerCase());
    if (specs.ah) parts.push(specs.ah.toLowerCase());
    if (specs.btu) parts.push(specs.btu.toLowerCase());
    if (specs.screenSize && ['TV', 'APPLIANCE'].includes(category)) parts.push(specs.screenSize.toLowerCase());
  }
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

  // Gate 6: Physical specs must match (watts, litres, kWh, etc.)
  // A 20L microwave is NOT the same product as a 32L microwave
  const specKeys: (keyof ProductSpecs)[] = ['watts', 'litres', 'kwh', 'ah', 'btu'];
  for (const key of specKeys) {
    const aVal = a.specs?.[key];
    const bVal = b.specs?.[key];
    if (aVal && bVal && aVal.toLowerCase() !== bVal.toLowerCase()) {
      return {
        isMatch: false,
        confidence: 0,
        matchedAttributes: matched,
        mismatchedAttributes: [key],
        explanation: `Spec mismatch (${key}): ${aVal} vs ${bVal}`,
      };
    }
    if (aVal && bVal && aVal.toLowerCase() === bVal.toLowerCase()) {
      matched.push(key);
      score += 10;
    }
  }

  // Screen size gate — only for TVs (phone screen sizes vary by listing title)
  if (['TV', 'APPLIANCE'].includes(a.category)) {
    const aScreen = a.specs?.screenSize;
    const bScreen = b.specs?.screenSize;
    if (aScreen && bScreen && aScreen !== bScreen) {
      return {
        isMatch: false,
        confidence: 0,
        matchedAttributes: matched,
        mismatchedAttributes: ['screenSize'],
        explanation: `Screen size mismatch: ${aScreen} vs ${bScreen}`,
      };
    }
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
    SOLAR_POWER: 5000,
    GENERATOR: 30000,
    AIR_CONDITIONER: 50000,
    APPLIANCE: 3000,
    STORAGE_DEVICE: 3000,
    NETWORKING: 5000,
    PRINTER: 15000,
  };

  const minPrice = MIN_PRICES[category];
  if (minPrice && price < minPrice) return true;
  return false;
}
