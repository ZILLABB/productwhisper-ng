import { NigerianSentimentEngine } from '@/core/services/NigerianSentimentEngine';

const engine = new NigerianSentimentEngine();

describe('NigerianSentimentEngine', () => {
  // ─── Basic Sentiment Detection ───────────────────────

  describe('basic sentiment detection', () => {
    it('detects positive English reviews', () => {
      const result = engine.analyze('This product is excellent, amazing quality. I love it!');
      expect(result.sentiment_score).toBeGreaterThan(0.5);
      expect(result.label).toBe('positive');
      expect(result.key_praises.length).toBeGreaterThan(0);
    });

    it('detects negative English reviews', () => {
      const result = engine.analyze('Terrible product, worst purchase ever. I hate this broken item.');
      expect(result.sentiment_score).toBeLessThan(-0.5);
      expect(result.label).toBe('negative');
      expect(result.key_complaints.length).toBeGreaterThan(0);
    });

    it('detects neutral/empty text', () => {
      const result = engine.analyze('I received the package today at my address.');
      expect(result.confidence).toBeLessThan(0.3);
    });
  });

  // ─── Nigerian Pidgin Detection ───────────────────────

  describe('Nigerian pidgin/slang detection', () => {
    it('detects positive pidgin expressions', () => {
      const result = engine.analyze('This phone correct! E dey work well well. No wahala at all.');
      expect(result.sentiment_score).toBeGreaterThan(0.3);
      expect(result.label).toBe('positive');
      expect(result.details.nigerianTermsFound).toContain('correct');
      expect(result.details.nigerianTermsFound).toContain('e dey work');
      expect(result.details.nigerianTermsFound).toContain('no wahala');
    });

    it('detects negative pidgin expressions', () => {
      const result = engine.analyze('Wahala o! This thing e no work. Na rubbish dem sell me.');
      expect(result.sentiment_score).toBeLessThan(-0.3);
      expect(result.label).toBe('negative');
      expect(result.details.nigerianTermsFound).toContain('wahala');
      expect(result.details.nigerianTermsFound).toContain('e no work');
    });

    it('detects "na die" as strong positive', () => {
      const result = engine.analyze('This laptop na die! Sharpest specs for the price.');
      expect(result.sentiment_score).toBeGreaterThan(0.5);
      expect(result.details.nigerianTermsFound).toContain('na die');
      expect(result.details.nigerianTermsFound).toContain('sharpest');
    });

    it('detects "dey kampe" as positive', () => {
      const result = engine.analyze('My new phone dey kampe, gbam!');
      expect(result.sentiment_score).toBeGreaterThan(0.3);
      expect(result.details.nigerianTermsFound).toContain('dey kampe');
      expect(result.details.nigerianTermsFound).toContain('gbam');
    });

    it('detects "manage" as mildly negative', () => {
      const result = engine.analyze('I dey manage am. Not great but okay.');
      expect(result.details.nigerianTermsFound).toContain('manage');
      expect(result.key_complaints).toContain('just managing (mediocre)');
    });
  });

  // ─── Scam Detection ──────────────────────────────────

  describe('scam signal detection', () => {
    it('detects "419" scam reference', () => {
      const result = engine.analyze('This is pure 419, fake product!');
      expect(result.scam_signals.length).toBeGreaterThan(0);
      expect(result.scam_signals).toContain('419 scam reference');
      expect(result.sentiment_score).toBeLessThan(-0.5);
    });

    it('detects "chop my money" as scam signal', () => {
      const result = engine.analyze('Dem chop my money with this fake item');
      expect(result.scam_signals).toContain('took my money (scam)');
    });

    it('detects "wayo" (trickery)', () => {
      const result = engine.analyze('Na pure wayo this seller dey do');
      expect(result.scam_signals).toContain('fraud/trickery');
      expect(result.sentiment_score).toBeLessThan(-0.5);
    });

    it('detects counterfeit/fake signals', () => {
      const result = engine.analyze('Counterfeit product! Fake item, total scam. Not what I ordered.');
      expect(result.scam_signals.length).toBeGreaterThanOrEqual(2);
      expect(result.label).toBe('negative');
    });

    it('detects "not as described" as scam', () => {
      const result = engine.analyze('Product not as described, different from the picture.');
      expect(result.scam_signals.length).toBeGreaterThan(0);
    });
  });

  // ─── Rating Influence ────────────────────────────────

  describe('star rating influence', () => {
    it('5-star rating boosts positive score', () => {
      const withRating = engine.analyze('Okay product', 'product_review', 5);
      const withoutRating = engine.analyze('Okay product', 'product_review');
      expect(withRating.sentiment_score).toBeGreaterThan(withoutRating.sentiment_score);
    });

    it('1-star rating pushes score negative', () => {
      const withRating = engine.analyze('Okay product', 'product_review', 1);
      const withoutRating = engine.analyze('Okay product', 'product_review');
      expect(withRating.sentiment_score).toBeLessThan(withoutRating.sentiment_score);
    });

    it('rating increases confidence', () => {
      const withRating = engine.analyze('I bought this phone', 'product_review', 4);
      const withoutRating = engine.analyze('I bought this phone', 'product_review');
      expect(withRating.confidence).toBeGreaterThan(withoutRating.confidence);
    });

    it('handles invalid ratings gracefully', () => {
      const result = engine.analyze('Good phone', 'product_review', 0);
      expect(result.sentiment_score).toBeDefined();
      expect(result.label).toBeDefined();
    });
  });

  // ─── Negation Handling ───────────────────────────────

  describe('negation handling', () => {
    it('negates positive words after "not"', () => {
      const positive = engine.analyze('This phone is good');
      const negated = engine.analyze('This phone is not good');
      expect(negated.sentiment_score).toBeLessThan(positive.sentiment_score);
    });

    it('negates negative words after "not"', () => {
      const negative = engine.analyze('This phone is terrible');
      const negated = engine.analyze('This phone is not terrible');
      expect(negated.sentiment_score).toBeGreaterThan(negative.sentiment_score);
    });
  });

  // ─── Mixed Sentiment ─────────────────────────────────

  describe('mixed sentiment detection', () => {
    it('detects mixed reviews with both praise and complaints', () => {
      const result = engine.analyze('The camera is excellent but the battery is terrible and slow.');
      expect(result.key_praises.length).toBeGreaterThan(0);
      expect(result.key_complaints.length).toBeGreaterThan(0);
    });

    it('correctly labels ambivalent reviews', () => {
      const result = engine.analyze('Good screen quality but terrible battery life. I love the design but hate the software.');
      expect(['mixed', 'negative', 'neutral']).toContain(result.label);
      expect(result.key_praises.length).toBeGreaterThan(0);
      expect(result.key_complaints.length).toBeGreaterThan(0);
    });
  });

  // ─── Batch Analysis ──────────────────────────────────

  describe('batch analysis', () => {
    it('processes multiple texts correctly', () => {
      const items = [
        { id: '1', text: 'Excellent phone, very sharp!' },
        { id: '2', text: 'Terrible, worst product ever' },
        { id: '3', text: 'Normal delivery, okay product' },
      ];

      const results = engine.analyzeBatch(items);

      expect(results.size).toBe(3);
      expect(results.get('1')!.sentiment_score).toBeGreaterThan(0);
      expect(results.get('2')!.sentiment_score).toBeLessThan(0);
    });

    it('includes ratings when provided', () => {
      const items = [
        { id: '1', text: 'Okay phone', rating: 5 },
        { id: '2', text: 'Okay phone', rating: 1 },
      ];

      const results = engine.analyzeBatch(items);
      expect(results.get('1')!.sentiment_score).toBeGreaterThan(results.get('2')!.sentiment_score);
    });
  });

  // ─── E-commerce Specific Patterns ────────────────────

  describe('e-commerce specific patterns', () => {
    it('detects refund requests as negative', () => {
      const result = engine.analyze('I want a refund, this product is defective');
      expect(result.sentiment_score).toBeLessThan(-0.3);
      expect(result.key_complaints.length).toBeGreaterThan(0);
    });

    it('detects value for money as positive', () => {
      const result = engine.analyze('Great value for money, affordable and durable');
      expect(result.sentiment_score).toBeGreaterThan(0.3);
      expect(result.key_praises).toContain('good value');
    });

    it('detects overheating issues', () => {
      const result = engine.analyze('This phone keeps overheating, very slow performance');
      expect(result.sentiment_score).toBeLessThan(0);
      expect(result.key_complaints.length).toBeGreaterThan(0);
    });

    it('detects product recommendation as strong positive', () => {
      const result = engine.analyze('I highly recommend this product, it is reliable and sturdy');
      expect(result.sentiment_score).toBeGreaterThan(0.3);
      expect(result.key_praises).toContain('recommends');
    });
  });

  // ─── Health Check ────────────────────────────────────

  describe('health check', () => {
    it('always returns true (in-process engine)', () => {
      expect(engine.healthCheck()).toBe(true);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = engine.analyze('');
      expect(result.sentiment_score).toBe(0);
      expect(result.confidence).toBeLessThanOrEqual(0.1);
    });

    it('handles very short text', () => {
      const result = engine.analyze('ok');
      expect(result).toBeDefined();
      expect(result.label).toBeDefined();
    });

    it('handles text with only punctuation', () => {
      const result = engine.analyze('!!! ??? ...');
      expect(result.sentiment_score).toBe(0);
    });

    it('handles repeated keywords', () => {
      const result = engine.analyze('good good good good good');
      expect(result.sentiment_score).toBeGreaterThan(0);
      // Multiple matches should increase confidence
      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it('handles very long text', () => {
      const longText = 'This is a great product. '.repeat(100);
      const result = engine.analyze(longText);
      expect(result.sentiment_score).toBeGreaterThan(0);
      expect(result).toBeDefined();
    });
  });
});
