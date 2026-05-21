/**
 * Quick test script to verify scrapers work against live sites.
 * Run: npx tsx scripts/test-scraper.ts
 */
import { JumiaScraper } from '../src/infrastructure/scrapers/JumiaScraper';

async function testJumia() {
  console.log('=== Testing Jumia Scraper ===\n');
  const scraper = new JumiaScraper();

  try {
    console.log('1. Searching for "Samsung Galaxy"...');
    const results = await scraper.searchProducts({
      query: 'Samsung Galaxy',
      maxResults: 3,
      maxPages: 1,
    });

    console.log(`   Found ${results.length} products:\n`);
    for (const p of results) {
      console.log(`   [${p.externalId}] ${p.title}`);
      console.log(`   Price: ₦${p.price.toLocaleString()} | Vendor: ${p.vendor?.name || 'N/A'} | Condition: ${p.condition}`);
      console.log(`   URL: ${p.url.substring(0, 80)}...`);
      console.log('');
    }

    if (results.length > 0) {
      console.log('2. Getting product details (JSON-LD)...');
      const detail = await scraper.getProductDetails(results[0].url);
      if (detail) {
        console.log(`   Title: ${detail.title}`);
        console.log(`   Price: ₦${detail.price.toLocaleString()}`);
        console.log(`   Brand: ${(detail.metadata as any)?.brand || 'N/A'}`);
        console.log(`   Category: ${(detail.metadata as any)?.category || 'N/A'}`);
        console.log(`   Rating: ${(detail.metadata as any)?.rating || 'N/A'} (${(detail.metadata as any)?.reviewCount || 0} reviews)`);
        console.log(`   Vendor: ${detail.vendor?.name || 'N/A'} (verified: ${detail.vendor?.isVerified})`);
        console.log(`   Image: ${detail.imageUrl?.substring(0, 80)}...`);
        console.log(`   Description: ${detail.description?.substring(0, 150)}...`);
        console.log(`   Source: ${(detail.metadata as any)?.source || 'css'}`);
        console.log(`   Inline reviews: ${detail.reviews?.length || 0}`);
      } else {
        console.log('   Failed to get product details');
      }

      console.log('\n3. Getting reviews...');
      const reviews = await scraper.getProductReviews(results[0].url, 1);
      console.log(`   Found ${reviews.length} reviews`);
      for (const r of reviews.slice(0, 5)) {
        console.log(`   [${r.rating || '?'}★] ${r.author || 'Anon'}: ${r.content.substring(0, 80)}`);
      }
    }

    // Test another search
    console.log('\n4. Searching for "iPhone"...');
    const iphones = await scraper.searchProducts({ query: 'iPhone', maxResults: 3, maxPages: 1 });
    console.log(`   Found ${iphones.length} products`);
    for (const p of iphones) {
      console.log(`   - ${p.title} | ₦${p.price.toLocaleString()}`);
    }

    console.log('\n5. Searching for "Tecno Spark"...');
    const tecnos = await scraper.searchProducts({ query: 'Tecno Spark', maxResults: 3, maxPages: 1 });
    console.log(`   Found ${tecnos.length} products`);
    for (const p of tecnos) {
      console.log(`   - ${p.title} | ₦${p.price.toLocaleString()}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Search: ✅ Working`);
    console.log(`Details (JSON-LD): ${results.length > 0 ? '✅ Working' : '❌ No results'}`);
    console.log(`Reviews: ${(await scraper.getProductReviews(results[0]?.url || '', 1)).length > 0 ? '✅ Working' : '⚠️ No reviews found'}`);

  } catch (err) {
    console.error('Scraper test failed:', err);
  }
}

testJumia();
