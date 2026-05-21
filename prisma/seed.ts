import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ─── API Key ───────────────────────────────────────────
  const apiKey = await prisma.apiKey.upsert({
    where: { key: 'pw-dev-key-change-me' },
    update: {},
    create: {
      key: 'pw-dev-key-change-me',
      name: 'Development Key',
      isActive: true,
      rateLimit: 1000,
    },
  });
  console.log(`API Key: ${apiKey.key}`);

  // ─── Products ──────────────────────────────────────────
  const products = [
    {
      name: 'Samsung Galaxy A15',
      brand: 'Samsung',
      category: 'Smartphones',
      slug: 'samsung-galaxy-a15',
      description: '6.5-inch Super AMOLED display, 128GB ROM, 6GB RAM, 50MP triple camera, 5000mAh battery with 25W fast charging. Runs Android 14 with One UI 6.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Samsung+Galaxy+A15',
    },
    {
      name: 'Infinix Hot 40i',
      brand: 'Infinix',
      category: 'Smartphones',
      slug: 'infinix-hot-40i',
      description: '6.56-inch IPS LCD, 128GB storage, 8GB RAM (4+4GB extended), 13MP AI dual camera, 5000mAh battery. Powered by Unisoc T606 processor.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Infinix+Hot+40i',
    },
    {
      name: 'Tecno Spark 20 Pro+',
      brand: 'Tecno',
      category: 'Smartphones',
      slug: 'tecno-spark-20-pro-plus',
      description: '6.78-inch display with 120Hz refresh rate, 256GB ROM, 8GB RAM, 108MP camera with OIS, 5000mAh battery with 33W fast charging.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Tecno+Spark+20+Pro%2B',
    },
    {
      name: 'iPhone 15 Pro Max',
      brand: 'Apple',
      category: 'Smartphones',
      slug: 'iphone-15-pro-max',
      description: '6.7-inch Super Retina XDR display with ProMotion. A17 Pro chip, 256GB storage, 48MP main camera with 5x optical zoom, titanium design, USB-C.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=iPhone+15+Pro+Max',
    },
    {
      name: 'Oraimo FreePods 4',
      brand: 'Oraimo',
      category: 'Audio',
      slug: 'oraimo-freepods-4',
      description: 'True wireless earbuds with Active Noise Cancellation, 30-hour total battery life, IPX5 water resistance, Bluetooth 5.3, and deep bass ENC technology.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Oraimo+FreePods+4',
    },
    {
      name: 'Hisense 43 inch Smart TV',
      brand: 'Hisense',
      category: 'TVs',
      slug: 'hisense-43-inch-smart-tv',
      description: '43-inch Full HD Smart TV with VIDAA OS, built-in WiFi, Netflix and YouTube apps, Dolby Audio, HDMI x2, USB x2, screen mirroring.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Hisense+43+Smart+TV',
    },
    {
      name: 'Binatone Blender BLG-402',
      brand: 'Binatone',
      category: 'Home Appliances',
      slug: 'binatone-blender-blg-402',
      description: '1.5L capacity blender with grinder attachment, 400W motor, stainless steel blades, pulse function, BPA-free jar, and overload protection.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Binatone+Blender',
    },
    {
      name: 'HP Laptop 15',
      brand: 'HP',
      category: 'Laptops',
      slug: 'hp-laptop-15',
      description: '15.6-inch FHD display, Intel Core i5-1235U, 8GB DDR4 RAM, 512GB SSD, Intel UHD Graphics, Windows 11 Home, WiFi 6, Bluetooth 5.2.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=HP+Laptop+15',
    },
    {
      name: 'Itel P40+',
      brand: 'Itel',
      category: 'Smartphones',
      slug: 'itel-p40-plus',
      description: '6.6-inch HD+ display, 64GB ROM, 4GB RAM (2+2GB extended), 13MP AI camera, 6000mAh mega battery with reverse charging. Budget-friendly.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Itel+P40%2B',
    },
    {
      name: 'Redmi Note 13',
      brand: 'Xiaomi',
      category: 'Smartphones',
      slug: 'redmi-note-13',
      description: '6.67-inch AMOLED 120Hz display, 128GB ROM, 8GB RAM, Snapdragon 685 processor, 108MP camera, 5000mAh battery with 33W fast charging.',
      imageUrl: 'https://placehold.co/500x500/1a1a2e/e0e0e0?text=Redmi+Note+13',
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: { description: p.description, imageUrl: p.imageUrl },
      create: { id: randomUUID(), ...p },
    });
  }
  console.log(`Seeded ${products.length} products`);

  // ─── Vendors ───────────────────────────────────────────
  const vendors = [
    { platform: 'JUMIA' as const, externalId: 'jumia-official', name: 'Jumia Official Store', isVerified: true, rating: 4.5, totalSales: 50000 },
    { platform: 'KONGA' as const, externalId: 'konga-official', name: 'Konga Official Store', isVerified: true, rating: 4.3, totalSales: 30000 },
    { platform: 'JIJI' as const, externalId: 'lagos-phones', name: 'Lagos Phones Hub', isVerified: false, rating: 3.8, totalSales: 150 },
    { platform: 'KONGA' as const, externalId: 'konga-gadgets', name: 'Konga Gadget World', isVerified: true, rating: 4.1, totalSales: 12000 },
    { platform: 'JIJI' as const, externalId: 'abuja-electronics', name: 'Abuja Electronics Plaza', isVerified: false, rating: 3.5, totalSales: 320 },
  ];

  for (const v of vendors) {
    await prisma.vendor.upsert({
      where: { platform_externalId: { platform: v.platform, externalId: v.externalId } },
      update: {},
      create: v,
    });
  }
  console.log(`Seeded ${vendors.length} vendors`);

  // ─── Fetch seeded data ─────────────────────────────────
  const seededProducts = await prisma.product.findMany();
  const allVendors = await prisma.vendor.findMany();

  const findProduct = (slug: string) => seededProducts.find(p => p.slug === slug);
  const findVendor = (extId: string) => allVendors.find(v => v.externalId === extId);
  const productImage = (name: string) => `https://placehold.co/500x500/1a1a2e/e0e0e0?text=${encodeURIComponent(name)}`;

  // ─── Listings (prices across platforms) ────────────────
  const listings = [
    // Samsung Galaxy A15
    {
      productSlug: 'samsung-galaxy-a15',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-samsung-a15',
      title: 'Samsung Galaxy A15 - 6.5" - 128GB ROM - 6GB RAM - Blue Black',
      price: 115000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/47/4463571/1.jpg',
      url: 'https://www.jumia.com.ng/samsung-galaxy-a15-123456.html',
    },
    {
      productSlug: 'samsung-galaxy-a15',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-samsung-a15',
      title: 'Samsung Galaxy A15 128GB/6GB - Blue Black',
      price: 119500,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/47/4463571/1.jpg',
      url: 'https://www.konga.com/product/samsung-galaxy-a15',
    },
    // Infinix Hot 40i
    {
      productSlug: 'infinix-hot-40i',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-infinix-hot40i',
      title: 'Infinix Hot 40i - 6.56" - 128GB/8GB - Starlit Black',
      price: 108000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/9218472/1.jpg',
      url: 'https://www.jumia.com.ng/infinix-hot-40i-234567.html',
    },
    {
      productSlug: 'infinix-hot-40i',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-infinix-hot40i',
      title: 'Infinix Hot 40i 128GB - Palm Blue',
      price: 112000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/9218472/1.jpg',
      url: 'https://www.konga.com/product/infinix-hot-40i',
    },
    // Tecno Spark 20 Pro+
    {
      productSlug: 'tecno-spark-20-pro-plus',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-tecno-spark20pp',
      title: 'Tecno Spark 20 Pro+ - 6.78" - 256GB/8GB - Magic Skin Green',
      price: 165000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/61/0694962/1.jpg',
      url: 'https://www.jumia.com.ng/tecno-spark-20-pro-345678.html',
    },
    {
      productSlug: 'tecno-spark-20-pro-plus',
      vendorExtId: 'konga-gadgets',
      platform: 'KONGA' as const,
      externalId: 'konga-tecno-spark20pp',
      title: 'Tecno Spark 20 Pro+ 256GB - Black',
      price: 169900,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/61/0694962/1.jpg',
      url: 'https://www.konga.com/product/tecno-spark-20-pro-plus',
    },
    // iPhone 15 Pro Max
    {
      productSlug: 'iphone-15-pro-max',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-iphone15pm',
      title: 'Apple iPhone 15 Pro Max - 256GB - Natural Titanium',
      price: 1850000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/60/2987003/1.jpg',
      url: 'https://www.jumia.com.ng/apple-iphone-15-pro-max-456789.html',
    },
    {
      productSlug: 'iphone-15-pro-max',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-iphone15pm',
      title: 'iPhone 15 Pro Max 256GB - Natural Titanium',
      price: 1899000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/60/2987003/1.jpg',
      url: 'https://www.konga.com/product/iphone-15-pro-max',
    },
    {
      productSlug: 'iphone-15-pro-max',
      vendorExtId: 'lagos-phones',
      platform: 'JIJI' as const,
      externalId: 'jiji-iphone15pm',
      title: 'iPhone 15 Pro Max 256GB - Used (Like New)',
      price: 1550000,
      condition: 'UK_USED' as const,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/60/2987003/1.jpg',
      url: 'https://jiji.ng/lagos/apple-iphone-15-pro-max',
    },
    // Oraimo FreePods 4
    {
      productSlug: 'oraimo-freepods-4',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-oraimo-fp4',
      title: 'Oraimo FreePods 4 - ANC - 30Hr Battery - Black',
      price: 18500,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/01/7895042/1.jpg',
      url: 'https://www.jumia.com.ng/oraimo-freepods-4-567890.html',
    },
    {
      productSlug: 'oraimo-freepods-4',
      vendorExtId: 'konga-gadgets',
      platform: 'KONGA' as const,
      externalId: 'konga-oraimo-fp4',
      title: 'Oraimo FreePods 4 Wireless Earbuds - Black',
      price: 19200,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/01/7895042/1.jpg',
      url: 'https://www.konga.com/product/oraimo-freepods-4',
    },
    // Hisense 43" Smart TV
    {
      productSlug: 'hisense-43-inch-smart-tv',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-hisense-43tv',
      title: 'Hisense 43" Full HD Smart TV - VIDAA - 43A4H',
      price: 195000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/93/2161802/1.jpg',
      url: 'https://www.jumia.com.ng/hisense-43-smart-tv-678901.html',
    },
    {
      productSlug: 'hisense-43-inch-smart-tv',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-hisense-43tv',
      title: 'Hisense 43A4H 43" Smart TV',
      price: 198000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/93/2161802/1.jpg',
      url: 'https://www.konga.com/product/hisense-43-smart-tv',
    },
    // Binatone Blender
    {
      productSlug: 'binatone-blender-blg-402',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-binatone-blg402',
      title: 'Binatone Blender BLG-402 - 1.5L - With Grinder',
      price: 22500,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/08/892509/1.jpg',
      url: 'https://www.jumia.com.ng/binatone-blender-789012.html',
    },
    {
      productSlug: 'binatone-blender-blg-402',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-binatone-blg402',
      title: 'Binatone BLG-402 Blender With Grinder - 1.5L',
      price: 23800,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/08/892509/1.jpg',
      url: 'https://www.konga.com/product/binatone-blender-blg-402',
    },
    // HP Laptop 15
    {
      productSlug: 'hp-laptop-15',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-hp-laptop15',
      title: 'HP Laptop 15 - Intel Core i5 - 8GB RAM - 512GB SSD - Win 11',
      price: 485000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/91/5803803/1.jpg',
      url: 'https://www.jumia.com.ng/hp-laptop-15-890123.html',
    },
    {
      productSlug: 'hp-laptop-15',
      vendorExtId: 'konga-official',
      platform: 'KONGA' as const,
      externalId: 'konga-hp-laptop15',
      title: 'HP 15 Laptop - Core i5/8GB/512GB - Silver',
      price: 495000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/91/5803803/1.jpg',
      url: 'https://www.konga.com/product/hp-laptop-15',
    },
    // Itel P40+
    {
      productSlug: 'itel-p40-plus',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-itel-p40plus',
      title: 'Itel P40+ - 6.6" - 64GB/4GB - 6000mAh - Force Black',
      price: 62500,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/3504172/1.jpg',
      url: 'https://www.jumia.com.ng/itel-p40-plus-901234.html',
    },
    {
      productSlug: 'itel-p40-plus',
      vendorExtId: 'abuja-electronics',
      platform: 'JIJI' as const,
      externalId: 'jiji-itel-p40plus',
      title: 'Itel P40+ 64GB - Brand New Sealed',
      price: 58000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/3504172/1.jpg',
      url: 'https://jiji.ng/abuja/itel-p40-plus',
    },
    // Redmi Note 13
    {
      productSlug: 'redmi-note-13',
      vendorExtId: 'jumia-official',
      platform: 'JUMIA' as const,
      externalId: 'jumia-redmi-note13',
      title: 'Xiaomi Redmi Note 13 - 6.67" AMOLED - 128GB/8GB - Midnight Black',
      price: 168000,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/1135483/1.jpg',
      url: 'https://www.jumia.com.ng/redmi-note-13-012345.html',
    },
    {
      productSlug: 'redmi-note-13',
      vendorExtId: 'konga-gadgets',
      platform: 'KONGA' as const,
      externalId: 'konga-redmi-note13',
      title: 'Redmi Note 13 128GB/8GB - Ice Blue',
      price: 172500,
      imageUrl: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/1135483/1.jpg',
      url: 'https://www.konga.com/product/redmi-note-13',
    },
  ];

  for (const l of listings) {
    const product = findProduct(l.productSlug);
    const vendor = findVendor(l.vendorExtId);
    if (!product || !vendor) {
      console.warn(`Skipping listing ${l.externalId}: product or vendor not found`);
      continue;
    }

    const listingImage = productImage(product.name);
    await prisma.productListing.upsert({
      where: { platform_externalId: { platform: l.platform, externalId: l.externalId } },
      update: { price: l.price, imageUrl: listingImage },
      create: {
        productId: product.id,
        platform: l.platform,
        externalId: l.externalId,
        title: l.title,
        price: l.price,
        currency: 'NGN',
        condition: (l as any).condition || 'NEW',
        url: l.url,
        imageUrl: listingImage,
        vendorId: vendor.id,
      },
    });
  }
  console.log(`Seeded ${listings.length} product listings`);

  // ─── Price History (last 30 days for all products) ─────
  const now = new Date();
  for (const l of listings) {
    const product = findProduct(l.productSlug);
    if (!product) continue;

    // Create 5 price history entries over 30 days with small fluctuations
    const basePrice = l.price;
    for (let i = 0; i < 5; i++) {
      const daysAgo = 30 - (i * 6); // ~every 6 days
      const fluctuation = 1 + (Math.random() * 0.06 - 0.03); // +/- 3%
      const historicalPrice = Math.round(basePrice * fluctuation);
      const recordedAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      await prisma.priceHistory.create({
        data: {
          productId: product.id,
          platform: l.platform,
          price: historicalPrice,
          currency: 'NGN',
          condition: (l as any).condition || 'NEW',
          recordedAt,
        },
      });
    }
  }
  console.log('Seeded price history');

  // ─── Sentiment Analyses (sample data) ──────────────────
  const sentimentData = [
    { slug: 'samsung-galaxy-a15', platform: 'JUMIA' as const, score: 0.72, confidence: 0.85, praises: ['Great display', 'Good battery life', 'Affordable price'], complaints: ['Average camera in low light', 'Slow charging'] },
    { slug: 'infinix-hot-40i', platform: 'JUMIA' as const, score: 0.68, confidence: 0.80, praises: ['Budget friendly', 'Extended RAM works well', 'Nice design'], complaints: ['Camera quality could be better', 'No fast charging'] },
    { slug: 'tecno-spark-20-pro-plus', platform: 'JUMIA' as const, score: 0.75, confidence: 0.82, praises: ['108MP camera is sharp', 'Fast charging', 'Smooth 120Hz display'], complaints: ['Heats up during gaming', 'Bloatware'] },
    { slug: 'iphone-15-pro-max', platform: 'JUMIA' as const, score: 0.91, confidence: 0.95, praises: ['Best camera system', 'Premium build quality', 'Excellent performance'], complaints: ['Very expensive in Nigeria', 'No charger in box'] },
    { slug: 'oraimo-freepods-4', platform: 'JUMIA' as const, score: 0.70, confidence: 0.78, praises: ['Good ANC for the price', 'Comfortable fit', 'Long battery'], complaints: ['Call quality average', 'Touch controls finicky'] },
    { slug: 'hisense-43-inch-smart-tv', platform: 'JUMIA' as const, score: 0.74, confidence: 0.80, praises: ['Clear picture quality', 'Smart features work well', 'Good value'], complaints: ['Sound could be louder', 'Remote feels cheap'] },
    { slug: 'binatone-blender-blg-402', platform: 'JUMIA' as const, score: 0.65, confidence: 0.75, praises: ['Affordable', 'Grinder attachment useful', 'Easy to clean'], complaints: ['Motor not very powerful', 'Jar lid loose'] },
    { slug: 'hp-laptop-15', platform: 'JUMIA' as const, score: 0.78, confidence: 0.88, praises: ['Fast SSD performance', 'Good for office work', 'Reliable brand'], complaints: ['No dedicated GPU', 'Display could be brighter'] },
    { slug: 'itel-p40-plus', platform: 'JUMIA' as const, score: 0.62, confidence: 0.72, praises: ['Massive 6000mAh battery', 'Very affordable', 'Decent screen size'], complaints: ['Slow performance', 'Low storage', 'Camera underwhelming'] },
    { slug: 'redmi-note-13', platform: 'JUMIA' as const, score: 0.80, confidence: 0.87, praises: ['Beautiful AMOLED display', '108MP camera quality', 'Fast charging'], complaints: ['No 5G support', 'MIUI ads annoying'] },
  ];

  for (const s of sentimentData) {
    const product = findProduct(s.slug);
    if (!product) continue;

    await prisma.sentimentAnalysis.create({
      data: {
        productId: product.id,
        platform: s.platform,
        sentimentScore: s.score,
        confidence: s.confidence,
        keyPraises: s.praises,
        keyComplaints: s.complaints,
        scamSignals: [],
        rawOutput: {},
      },
    });
  }
  console.log('Seeded sentiment analyses');

  // ─── Trust Scores ──────────────────────────────────────
  for (const s of sentimentData) {
    const product = findProduct(s.slug);
    if (!product) continue;

    const trustScore = Math.round(s.score * 100);
    await prisma.trustScore.create({
      data: {
        productId: product.id,
        score: Math.min(trustScore, 100),
        factors: {
          sentimentScore: s.score,
          reviewCount: Math.floor(Math.random() * 200) + 20,
          verifiedVendor: true,
          priceConsistency: 0.85 + Math.random() * 0.15,
        },
        scamFlags: [],
      },
    });
  }
  console.log('Seeded trust scores');

  // ─── Search Analytics (trending queries) ───────────────
  const trendingQueries = [
    'samsung galaxy', 'iphone 15', 'infinix hot', 'tecno spark', 'oraimo',
    'smart tv', 'laptop', 'redmi note', 'earbuds', 'blender',
    'itel phone', 'hp laptop', 'wireless earphone', 'android phone', 'gaming laptop',
  ];

  for (const q of trendingQueries) {
    const count = Math.floor(Math.random() * 50) + 5;
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.floor(Math.random() * 7);
      await prisma.searchAnalytics.create({
        data: {
          query: q,
          normalizedQuery: q.toLowerCase().trim(),
          resultsCount: Math.floor(Math.random() * 20) + 1,
          responseTimeMs: Math.floor(Math.random() * 500) + 50,
          cacheHit: Math.random() > 0.5,
          createdAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  console.log('Seeded search analytics');

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
