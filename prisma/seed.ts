import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

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

  const products = [
    { name: 'Samsung Galaxy A15', brand: 'Samsung', category: 'Smartphones', slug: 'samsung-galaxy-a15' },
    { name: 'Infinix Hot 40i', brand: 'Infinix', category: 'Smartphones', slug: 'infinix-hot-40i' },
    { name: 'Tecno Spark 20 Pro+', brand: 'Tecno', category: 'Smartphones', slug: 'tecno-spark-20-pro-plus' },
    { name: 'iPhone 15 Pro Max', brand: 'Apple', category: 'Smartphones', slug: 'iphone-15-pro-max' },
    { name: 'Oraimo FreePods 4', brand: 'Oraimo', category: 'Audio', slug: 'oraimo-freepods-4' },
    { name: 'Hisense 43 inch Smart TV', brand: 'Hisense', category: 'TVs', slug: 'hisense-43-inch-smart-tv' },
    { name: 'Binatone Blender BLG-402', brand: 'Binatone', category: 'Home Appliances', slug: 'binatone-blender-blg-402' },
    { name: 'HP Laptop 15', brand: 'HP', category: 'Laptops', slug: 'hp-laptop-15' },
    { name: 'Itel P40+', brand: 'Itel', category: 'Smartphones', slug: 'itel-p40-plus' },
    { name: 'Redmi Note 13', brand: 'Xiaomi', category: 'Smartphones', slug: 'redmi-note-13' },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: { id: randomUUID(), ...p },
    });
  }
  console.log(`Seeded ${products.length} products`);

  const seededProducts = await prisma.product.findMany();

  const vendors = [
    { platform: 'JUMIA' as const, externalId: 'jumia-official', name: 'Jumia Official Store', isVerified: true, rating: 4.5, totalSales: 50000 },
    { platform: 'KONGA' as const, externalId: 'konga-official', name: 'Konga Official Store', isVerified: true, rating: 4.3, totalSales: 30000 },
    { platform: 'JIJI' as const, externalId: 'lagos-phones', name: 'Lagos Phones Hub', isVerified: false, rating: 3.8, totalSales: 150 },
  ];

  for (const v of vendors) {
    await prisma.vendor.upsert({
      where: { platform_externalId: { platform: v.platform, externalId: v.externalId } },
      update: {},
      create: v,
    });
  }
  console.log(`Seeded ${vendors.length} vendors`);

  const jumiaVendor = await prisma.vendor.findFirst({ where: { externalId: 'jumia-official' } });
  const samsung = seededProducts.find(p => p.slug === 'samsung-galaxy-a15');

  if (samsung && jumiaVendor) {
    await prisma.productListing.upsert({
      where: { platform_externalId: { platform: 'JUMIA', externalId: 'jumia-samsung-a15' } },
      update: {},
      create: {
        productId: samsung.id,
        platform: 'JUMIA',
        externalId: 'jumia-samsung-a15',
        title: 'Samsung Galaxy A15 - 6.5" - 128GB ROM - 6GB RAM - Dual SIM - Blue Black',
        price: 115000,
        currency: 'NGN',
        condition: 'NEW',
        url: 'https://www.jumia.com.ng/samsung-galaxy-a15-123456.html',
        vendorId: jumiaVendor.id,
      },
    });

    await prisma.priceHistory.create({
      data: {
        productId: samsung.id,
        platform: 'JUMIA',
        price: 115000,
        currency: 'NGN',
        condition: 'NEW',
      },
    });
  }

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
