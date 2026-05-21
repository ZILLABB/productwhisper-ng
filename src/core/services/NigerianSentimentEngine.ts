/**
 * NigerianSentimentEngine - Built-in sentiment analysis engine
 * optimized for Nigerian English, Pidgin, and e-commerce review patterns.
 *
 * This replaces the external Python API dependency with a robust
 * rule-based + keyword engine that understands Nigerian expressions.
 */

// ─── Nigerian Pidgin / Slang Lexicon ───────────────────

interface LexiconEntry {
  score: number;       // -1 to 1
  weight: number;      // multiplier for importance
  category: 'praise' | 'complaint' | 'scam' | 'neutral';
  label: string;

}

const NIGERIAN_LEXICON: Record<string, LexiconEntry> = {
  // ── Strong Positive (Nigerian) ──
  'correct':    { score: 0.8, weight: 1.2, category: 'praise', label: 'correct (good quality)' },
  'sharpest':   { score: 0.9, weight: 1.2, category: 'praise', label: 'very impressive' },
  'sharp':      { score: 0.7, weight: 1.0, category: 'praise', label: 'impressive/good' },
  'legit':      { score: 0.8, weight: 1.3, category: 'praise', label: 'legitimate/authentic' },
  'original':   { score: 0.7, weight: 1.3, category: 'praise', label: 'genuine product' },
  'no wahala':  { score: 0.7, weight: 1.0, category: 'praise', label: 'no problems' },
  'e dey work': { score: 0.7, weight: 1.0, category: 'praise', label: 'it works' },
  'na die':     { score: 0.8, weight: 1.0, category: 'praise', label: 'excellent' },
  'mad o':      { score: 0.8, weight: 1.0, category: 'praise', label: 'amazing' },
  'pepper dem': { score: 0.8, weight: 1.0, category: 'praise', label: 'impressive/outstanding' },
  'no regret':  { score: 0.8, weight: 1.2, category: 'praise', label: 'satisfied' },
  'e sweet':    { score: 0.7, weight: 1.0, category: 'praise', label: 'enjoyable/satisfying' },
  'on point':   { score: 0.7, weight: 1.0, category: 'praise', label: 'exactly right' },
  'dey kampe':  { score: 0.7, weight: 1.0, category: 'praise', label: 'doing well/solid' },
  'ehen':       { score: 0.3, weight: 0.5, category: 'praise', label: 'affirmative/yes' },
  'gbam':       { score: 0.6, weight: 1.0, category: 'praise', label: 'exactly/perfect' },
  'sabi':       { score: 0.5, weight: 0.8, category: 'praise', label: 'knows well/expert' },
  'jara':       { score: 0.5, weight: 0.8, category: 'praise', label: 'bonus/extra value' },

  // ── Strong Negative (Nigerian) ──
  'wahala':     { score: -0.7, weight: 1.2, category: 'complaint', label: 'trouble/problems' },
  'yawa':       { score: -0.8, weight: 1.2, category: 'complaint', label: 'embarrassment/disaster' },
  'palaver':    { score: -0.6, weight: 1.0, category: 'complaint', label: 'trouble/complication' },
  'nonsense':   { score: -0.8, weight: 1.2, category: 'complaint', label: 'rubbish quality' },
  'rubbish':    { score: -0.8, weight: 1.2, category: 'complaint', label: 'terrible' },
  'useless':    { score: -0.8, weight: 1.2, category: 'complaint', label: 'worthless' },
  'no vex':     { score: -0.3, weight: 0.5, category: 'complaint', label: 'don\'t be angry (context: apology)' },
  'chop my money': { score: -0.9, weight: 1.5, category: 'scam', label: 'took my money (scam)' },
  'con me':     { score: -0.9, weight: 1.5, category: 'scam', label: 'deceived me' },
  'wayo':       { score: -0.9, weight: 1.5, category: 'scam', label: 'fraud/trickery' },
  '419':        { score: -1.0, weight: 2.0, category: 'scam', label: '419 scam reference' },
  'oloshi':     { score: -0.8, weight: 1.0, category: 'complaint', label: 'worthless person/thing' },
  'kolo':       { score: -0.6, weight: 0.8, category: 'complaint', label: 'crazy/malfunctioning' },
  'na lie':     { score: -0.7, weight: 1.2, category: 'complaint', label: 'it\'s a lie/false advertising' },
  'omo see':    { score: -0.5, weight: 0.8, category: 'complaint', label: 'disappointment expression' },
  'e no work':  { score: -0.8, weight: 1.3, category: 'complaint', label: 'doesn\'t work' },
  'scatter':    { score: -0.7, weight: 1.0, category: 'complaint', label: 'broke/fell apart' },
  'spoil':      { score: -0.7, weight: 1.2, category: 'complaint', label: 'broken/damaged' },
  'fake':       { score: -0.9, weight: 1.5, category: 'scam', label: 'counterfeit product' },
  'china':      { score: -0.5, weight: 0.8, category: 'complaint', label: 'cheap knockoff' },
  'manage':     { score: -0.3, weight: 0.8, category: 'complaint', label: 'just managing (mediocre)' },

  // ── Standard English Positive ──
  'excellent':  { score: 0.9, weight: 1.2, category: 'praise', label: 'excellent' },
  'amazing':    { score: 0.9, weight: 1.2, category: 'praise', label: 'amazing' },
  'perfect':    { score: 0.9, weight: 1.2, category: 'praise', label: 'perfect' },
  'great':      { score: 0.8, weight: 1.0, category: 'praise', label: 'great' },
  'good':       { score: 0.6, weight: 0.8, category: 'praise', label: 'good' },
  'love':       { score: 0.8, weight: 1.0, category: 'praise', label: 'love it' },
  'recommend':  { score: 0.8, weight: 1.3, category: 'praise', label: 'recommends' },
  'best':       { score: 0.8, weight: 1.0, category: 'praise', label: 'best' },
  'quality':    { score: 0.6, weight: 0.8, category: 'praise', label: 'quality product' },
  'fast':       { score: 0.5, weight: 0.8, category: 'praise', label: 'fast performance/delivery' },
  'nice':       { score: 0.6, weight: 0.8, category: 'praise', label: 'nice' },
  'wonderful':  { score: 0.8, weight: 1.0, category: 'praise', label: 'wonderful' },
  'fantastic':  { score: 0.9, weight: 1.0, category: 'praise', label: 'fantastic' },
  'durable':    { score: 0.7, weight: 1.0, category: 'praise', label: 'durable' },
  'value for money': { score: 0.8, weight: 1.2, category: 'praise', label: 'good value' },
  'worth it':   { score: 0.7, weight: 1.1, category: 'praise', label: 'worth the price' },
  'sturdy':     { score: 0.6, weight: 0.9, category: 'praise', label: 'well-built' },
  'affordable': { score: 0.6, weight: 0.9, category: 'praise', label: 'affordable' },
  'reliable':   { score: 0.7, weight: 1.0, category: 'praise', label: 'reliable' },
  'smooth':     { score: 0.6, weight: 0.8, category: 'praise', label: 'smooth performance' },

  // ── Standard English Negative ──
  'terrible':   { score: -0.9, weight: 1.2, category: 'complaint', label: 'terrible' },
  'worst':      { score: -1.0, weight: 1.3, category: 'complaint', label: 'worst' },
  'horrible':   { score: -0.9, weight: 1.2, category: 'complaint', label: 'horrible' },
  'bad':        { score: -0.6, weight: 0.8, category: 'complaint', label: 'bad' },
  'hate':       { score: -0.8, weight: 1.0, category: 'complaint', label: 'hate' },
  'broken':     { score: -0.8, weight: 1.2, category: 'complaint', label: 'broken' },
  'poor':       { score: -0.6, weight: 0.8, category: 'complaint', label: 'poor quality' },
  'waste':      { score: -0.7, weight: 1.0, category: 'complaint', label: 'waste of money' },
  'slow':       { score: -0.5, weight: 0.8, category: 'complaint', label: 'slow performance' },
  'cheap':      { score: -0.4, weight: 0.7, category: 'complaint', label: 'cheap quality' },
  'disappointed': { score: -0.7, weight: 1.0, category: 'complaint', label: 'disappointed' },
  'refund':     { score: -0.7, weight: 1.2, category: 'complaint', label: 'wants refund' },
  'return':     { score: -0.5, weight: 0.9, category: 'complaint', label: 'wants to return' },
  'overpriced': { score: -0.5, weight: 0.9, category: 'complaint', label: 'too expensive' },
  'overheat':   { score: -0.6, weight: 1.0, category: 'complaint', label: 'overheating issue' },
  'crack':      { score: -0.6, weight: 1.0, category: 'complaint', label: 'cracked/defective' },
  'defective':  { score: -0.8, weight: 1.2, category: 'complaint', label: 'defective product' },
  'malfunction': { score: -0.8, weight: 1.2, category: 'complaint', label: 'malfunction' },

  // ── Scam-Specific Signals ──
  'scam':          { score: -1.0, weight: 2.0, category: 'scam', label: 'scam' },
  'fraud':         { score: -1.0, weight: 2.0, category: 'scam', label: 'fraud' },
  'counterfeit':   { score: -1.0, weight: 2.0, category: 'scam', label: 'counterfeit' },
  'not original':  { score: -0.9, weight: 1.8, category: 'scam', label: 'not original' },
  'not genuine':   { score: -0.9, weight: 1.8, category: 'scam', label: 'not genuine' },
  'different from': { score: -0.7, weight: 1.5, category: 'scam', label: 'product mismatch' },
  'not as described': { score: -0.8, weight: 1.5, category: 'scam', label: 'not as described' },
  'ripoff':        { score: -0.9, weight: 1.5, category: 'scam', label: 'ripoff' },
  'rip off':       { score: -0.9, weight: 1.5, category: 'scam', label: 'rip off' },
  'knockoff':      { score: -0.8, weight: 1.5, category: 'scam', label: 'knockoff product' },
  'grade a copy':  { score: -0.7, weight: 1.3, category: 'scam', label: 'copy/clone' },
  'first copy':    { score: -0.7, weight: 1.3, category: 'scam', label: 'first copy (clone)' },
  'not what i ordered': { score: -0.8, weight: 1.5, category: 'scam', label: 'wrong item sent' },
};

// ─── Negation Words ────────────────────────────────────

const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'neither', 'nor', 'nothing', 'nowhere',
  'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t', 'don\'t', 'doesn\'t',
  'didn\'t', 'haven\'t', 'hasn\'t', 'wouldn\'t', 'couldn\'t', 'shouldn\'t',
  'won\'t', 'can\'t', 'cannot',
  // Nigerian negation
  'no be', 'e no', 'nor', 'neva', 'no dey', 'no get',
]);

// ─── Intensifiers ──────────────────────────────────────

const INTENSIFIERS: Record<string, number> = {
  'very': 1.3,
  'extremely': 1.5,
  'super': 1.4,
  'really': 1.3,
  'absolutely': 1.5,
  'totally': 1.4,
  'highly': 1.3,
  'so': 1.2,
  'too': 1.2,
  'quite': 1.1,
  // Nigerian intensifiers
  'die': 1.5,     // "e sweet die" = extremely sweet
  'well well': 1.4,
  'plenty': 1.3,
  'pass': 1.3,    // "e fine pass" = it's better than
  'sha': 0.8,     // "e good sha" = it's okay (softener)
  'small': 0.7,   // "e bad small" = a bit bad
  'o': 1.2,       // emphasis marker
  'gan': 1.4,     // "e good gan" = really good
};

// ─── Rating-to-Score Mapping ───────────────────────────

function ratingToScore(rating: number | null | undefined): number | null {
  if (rating == null) return null;
  if (rating <= 0 || rating > 5) return null;
  // Map 1-5 star to -1 to 1
  return (rating - 3) / 2;
}

// ─── Sentence Splitter ─────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 2);
}

// ─── Main Analysis Interface ───────────────────────────

export interface SentimentAnalysisResult {
  sentiment_score: number;      // -1 to 1
  confidence: number;           // 0 to 1
  key_complaints: string[];
  key_praises: string[];
  scam_signals: string[];
  label: 'positive' | 'negative' | 'neutral' | 'mixed';
  details: {
    matchedTerms: number;
    textLength: number;
    nigerianTermsFound: string[];
    ratingInfluence: number | null;
  };
}

export class NigerianSentimentEngine {
  /**
   * Analyze a single text for sentiment
   */
  analyze(text: string, context: string = 'product_review', rating?: number | null): SentimentAnalysisResult {
    const lower = text.toLowerCase().trim();
    const sentences = splitSentences(lower);

    let totalScore = 0;
    let totalWeight = 0;
    let matchCount = 0;
    const complaints: Map<string, number> = new Map();
    const praises: Map<string, number> = new Map();
    const scamSignals: Set<string> = new Set();
    const nigerianTerms: string[] = [];

    // ── Phase 1: Multi-word phrase matching (longer phrases first) ──
    const sortedPhrases = Object.keys(NIGERIAN_LEXICON)
      .sort((a, b) => b.length - a.length);

    const processedRanges: Array<[number, number]> = [];

    for (const phrase of sortedPhrases) {
      let searchFrom = 0;
      while (true) {
        const idx = lower.indexOf(phrase, searchFrom);
        if (idx === -1) break;

        // Check this range hasn't been consumed by a longer phrase
        const endIdx = idx + phrase.length;
        const overlaps = processedRanges.some(([s, e]) =>
          (idx >= s && idx < e) || (endIdx > s && endIdx <= e)
        );

        if (!overlaps) {
          const entry = NIGERIAN_LEXICON[phrase];
          let score = entry.score;
          let weight = entry.weight;

          // Check for negation in the 3 words before the match
          const prefix = lower.substring(Math.max(0, idx - 30), idx).trim();
          const prefixWords = prefix.split(/\s+/);
          const lastFewWords = prefixWords.slice(-3);
          const isNegated = lastFewWords.some(w => NEGATION_WORDS.has(w));

          if (isNegated) {
            score = -score * 0.7; // Negate but reduce magnitude
          }

          // Check for intensifiers
          const lastWord = prefixWords[prefixWords.length - 1] ?? '';
          const intensifier = INTENSIFIERS[lastWord];
          if (intensifier) {
            score *= intensifier;
            weight *= 1.1;
          }

          totalScore += score * weight;
          totalWeight += weight;
          matchCount++;

          // Categorize
          if (entry.category === 'scam') {
            scamSignals.add(entry.label);
          }
          if ((score < 0 && !isNegated) || (score > 0 && isNegated)) {
            complaints.set(entry.label, (complaints.get(entry.label) ?? 0) + 1);
          }
          if ((score > 0 && !isNegated) || (score < 0 && isNegated)) {
            praises.set(entry.label, (praises.get(entry.label) ?? 0) + 1);
          }

          // Track Nigerian-specific terms
          if (['correct', 'sharpest', 'sharp', 'legit', 'wahala', 'yawa', 'palaver',
               'no wahala', 'e dey work', 'na die', 'mad o', 'pepper dem',
               'chop my money', 'con me', 'wayo', '419', 'oloshi', 'kolo',
               'na lie', 'e no work', 'spoil', 'manage', 'gbam', 'sabi',
               'jara', 'dey kampe', 'e sweet', 'on point', 'omo see', 'scatter'
          ].includes(phrase)) {
            nigerianTerms.push(phrase);
          }

          processedRanges.push([idx, endIdx]);
        }

        searchFrom = idx + 1;
      }
    }

    // ── Phase 2: Rating influence ──
    const ratingScore = ratingToScore(rating);
    let ratingInfluence: number | null = null;
    if (ratingScore !== null) {
      ratingInfluence = ratingScore;
      // Rating has strong influence when text has few signals
      const ratingWeight = matchCount < 3 ? 2.0 : 1.0;
      totalScore += ratingScore * ratingWeight;
      totalWeight += ratingWeight;
    }

    // ── Phase 3: Compute final score ──
    let sentimentScore: number;
    let confidence: number;

    if (totalWeight === 0) {
      // No signals found — truly neutral
      sentimentScore = 0;
      confidence = 0.1;
    } else {
      sentimentScore = totalScore / totalWeight;
      // Clamp to -1..1
      sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

      // Confidence based on: number of matches, text length, rating presence
      const matchConfidence = Math.min(1, matchCount / 5); // More matches = more confident
      const lengthConfidence = Math.min(1, text.length / 200); // Longer text = more confident
      const ratingBonus = ratingScore !== null ? 0.15 : 0;

      confidence = Math.min(0.95, matchConfidence * 0.5 + lengthConfidence * 0.35 + ratingBonus);
      confidence = Math.max(0.15, confidence); // Minimum 15% if we found anything
    }

    // ── Phase 4: Label ──
    let label: 'positive' | 'negative' | 'neutral' | 'mixed';
    if (praises.size > 0 && complaints.size > 0 && Math.abs(sentimentScore) < 0.2) {
      label = 'mixed';
    } else if (sentimentScore > 0.15) {
      label = 'positive';
    } else if (sentimentScore < -0.15) {
      label = 'negative';
    } else {
      label = 'neutral';
    }

    // Sort by frequency
    const keyComplaints = Array.from(complaints.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);

    const keyPraises = Array.from(praises.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);

    return {
      sentiment_score: Math.round(sentimentScore * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      key_complaints: keyComplaints,
      key_praises: keyPraises,
      scam_signals: Array.from(scamSignals),
      label,
      details: {
        matchedTerms: matchCount,
        textLength: text.length,
        nigerianTermsFound: nigerianTerms,
        ratingInfluence,
      },
    };
  }

  /**
   * Analyze a batch of texts
   */
  analyzeBatch(items: { id: string; text: string; rating?: number | null }[]): Map<string, SentimentAnalysisResult> {
    const results = new Map<string, SentimentAnalysisResult>();
    for (const item of items) {
      results.set(item.id, this.analyze(item.text, 'product_review', item.rating));
    }
    return results;
  }

  /**
   * Health check — always healthy since it's in-process
   */
  healthCheck(): boolean {
    return true;
  }
}

// Singleton instance
export const sentimentEngine = new NigerianSentimentEngine();
