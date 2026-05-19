import { JumiaScraper } from './JumiaScraper';
import { KongaScraper } from './KongaScraper';
import { JijiScraper } from './JijiScraper';
import { NairalandScraper } from './NairalandScraper';
import { YouTubeScraper } from './YouTubeScraper';
import type { BaseScraper } from './BaseScraper';

const scrapers = {
  JUMIA: new JumiaScraper(),
  KONGA: new KongaScraper(),
  JIJI: new JijiScraper(),
  NAIRALAND: new NairalandScraper(),
  YOUTUBE: new YouTubeScraper(),
} as const;

export function getScraper(platform: string): BaseScraper {
  const scraper = scrapers[platform as keyof typeof scrapers];
  if (!scraper) throw new Error(`No scraper for platform: ${platform}`);
  return scraper;
}

export function getNairalandScraper(): NairalandScraper {
  return scrapers.NAIRALAND;
}

export function getYouTubeScraper(): YouTubeScraper {
  return scrapers.YOUTUBE;
}

export { JumiaScraper, KongaScraper, JijiScraper, NairalandScraper, YouTubeScraper };
