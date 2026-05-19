from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import pipeline
import re
from typing import Optional

app = FastAPI(title="ProductWhisper Sentiment Service", version="1.0.0")

sentiment_pipeline = None

NIGERIAN_POSITIVE = [
    "original", "legit", "sharp", "correct", "working well", "worth it",
    "no wahala", "na correct", "better", "recommend", "quality", "fast delivery",
    "genuine", "trusted", "verified", "durable", "strong", "nice", "good",
    "perfect", "excellent", "love it", "solid", "fresh", "clean",
]

NIGERIAN_NEGATIVE = [
    "fake", "scam", "wahala", "rubbish", "useless", "bad", "terrible",
    "waste of money", "don't buy", "avoid", "chinko", "not original",
    "refurbished", "broken", "dead on arrival", "doa", "overpriced",
    "slow", "cheap quality", "regret", "disappointing", "fraud",
    "419", "yeye", "nonsense", "trash",
]

SCAM_SIGNALS = [
    "too good to be true", "wire transfer only", "no return", "cash only",
    "meet at", "don't come with police", "western union", "pay before delivery",
    "no refund", "as is", "sold as seen", "buyer beware", "no warranty",
    "used once", "like new", "brand new in box", "sealed",
    "whatsapp only", "dm only", "call only", "no questions asked",
]

COMPLAINT_PATTERNS = [
    r"battery\s+(?:life|drain|issue|problem|bad|poor|dies)",
    r"screen\s+(?:crack|broke|issue|problem|dim|flicker)",
    r"charging\s+(?:slow|issue|problem|port|not working)",
    r"(?:over)?heat(?:ing|s)",
    r"hang(?:s|ing)",
    r"(?:slow|lag(?:s|gy|ging))",
    r"camera\s+(?:bad|poor|blur|issue)",
    r"network\s+(?:issue|problem|poor|bad|no signal)",
    r"(?:delivery|shipping)\s+(?:slow|late|delay|issue)",
    r"customer\s+(?:service|support|care)\s+(?:bad|poor|terrible|useless)",
]

PRAISE_PATTERNS = [
    r"battery\s+(?:life|lasts?|good|great|excellent|long)",
    r"camera\s+(?:good|great|excellent|clear|sharp|quality)",
    r"fast\s+(?:charging|delivery|shipping|processor|performance)",
    r"(?:good|great|excellent)\s+(?:value|deal|price|quality|build)",
    r"(?:smooth|responsive|snappy)\s+(?:performance|screen|display)",
    r"(?:beautiful|nice|sleek|premium)\s+(?:design|look|build|body)",
]


class TextInput(BaseModel):
    text: str = Field(min_length=5, max_length=5000)


class BatchInput(BaseModel):
    texts: list[str] = Field(max_length=50)


class SentimentResult(BaseModel):
    score: float
    label: str
    confidence: float
    key_complaints: list[str]
    key_praises: list[str]
    scam_signals: list[str]


def get_pipeline():
    global sentiment_pipeline
    if sentiment_pipeline is None:
        try:
            sentiment_pipeline = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                truncation=True,
                max_length=512,
            )
        except Exception:
            sentiment_pipeline = "fallback"
    return sentiment_pipeline


def extract_patterns(text: str, patterns: list[str]) -> list[str]:
    text_lower = text.lower()
    found = []
    for pattern in patterns:
        if re.search(pattern, text_lower):
            match = re.search(pattern, text_lower)
            if match:
                found.append(match.group(0).strip())
    return list(set(found))


def detect_scam_signals(text: str) -> list[str]:
    text_lower = text.lower()
    return [signal for signal in SCAM_SIGNALS if signal in text_lower]


def keyword_score(text: str) -> float:
    text_lower = text.lower()
    pos = sum(1 for w in NIGERIAN_POSITIVE if w in text_lower)
    neg = sum(1 for w in NIGERIAN_NEGATIVE if w in text_lower)
    total = pos + neg
    if total == 0:
        return 0.5
    return pos / total


def analyze_text(text: str) -> SentimentResult:
    pipe = get_pipeline()

    if pipe == "fallback":
        score = keyword_score(text)
    else:
        result = pipe(text[:512])[0]
        ml_score = result["score"] if result["label"] == "POSITIVE" else 1 - result["score"]
        nigerian_score = keyword_score(text)
        score = 0.6 * ml_score + 0.4 * nigerian_score

    score = round(max(0.0, min(1.0, score)), 3)

    if score >= 0.65:
        label = "positive"
    elif score <= 0.35:
        label = "negative"
    else:
        label = "neutral"

    complaints = extract_patterns(text, COMPLAINT_PATTERNS)
    praises = extract_patterns(text, PRAISE_PATTERNS)
    scam = detect_scam_signals(text)

    confidence = abs(score - 0.5) * 2
    confidence = round(max(0.1, min(1.0, confidence)), 3)

    return SentimentResult(
        score=score,
        label=label,
        confidence=confidence,
        key_complaints=complaints,
        key_praises=praises,
        scam_signals=scam,
    )


@app.post("/analyze", response_model=SentimentResult)
async def analyze(input: TextInput):
    return analyze_text(input.text)


@app.post("/batch", response_model=list[SentimentResult])
async def batch_analyze(input: BatchInput):
    if len(input.texts) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 texts per batch")
    return [analyze_text(t) for t in input.texts if len(t) >= 5]


@app.get("/health")
async def health():
    pipe = get_pipeline()
    return {
        "status": "healthy",
        "model": "distilbert-base-uncased-finetuned-sst-2-english" if pipe != "fallback" else "fallback-keywords",
        "nigerian_keywords": len(NIGERIAN_POSITIVE) + len(NIGERIAN_NEGATIVE),
    }
