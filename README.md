# ProductWhisper NG

Nigeria-first AI product intelligence platform. Aggregates product data from Nigerian e-commerce platforms (Jumia, Konga, Jiji), community forums (Nairaland), and YouTube reviews to provide price comparison, sentiment analysis, and trust/scam detection.

## Architecture

```
src/
├── api/              # Fastify routes, middleware, plugins
│   ├── middleware/    # Auth (API key), error handler
│   ├── plugins/      # CORS, Helmet, rate limiting, Swagger
│   └── routes/       # products, prices, sentiment, trust, search, admin
├── core/             # Business logic services
│   └── services/     # Product, Price, Sentiment, Trust, Search, Ingestion
├── infrastructure/   # External integrations
│   ├── cache/        # Redis (ioredis)
│   ├── database/     # Prisma (PostgreSQL)
│   ├── queue/        # BullMQ job queues
│   └── scrapers/     # Jumia, Konga, Jiji, Nairaland, YouTube
├── shared/           # Constants, types, utils, errors
└── workers/          # BullMQ worker processes

python-services/
└── sentiment/        # FastAPI sentiment analysis (distilbert + Nigerian keywords)
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 16
- Redis 7
- Python 3.11+ (for sentiment service)

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your database/redis URLs

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed the database
npm run db:seed

# Start the API server
npm run dev

# Start workers (separate terminal)
npm run worker:dev
```

### Docker

```bash
docker-compose up -d
npx prisma migrate deploy
npm run db:seed
```

## API Endpoints

All endpoints require `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/products/search` | Search products with filters |
| GET | `/api/v1/products/:id` | Get product details |
| GET | `/api/v1/products/categories` | List categories |
| GET | `/api/v1/products/brands` | List brands |
| GET | `/api/v1/products/trending` | Trending products |
| GET | `/api/v1/prices/compare/:productId` | Cross-platform price comparison |
| GET | `/api/v1/prices/history/:productId` | Price history |
| GET | `/api/v1/prices/deals` | Current deals (price drops) |
| GET | `/api/v1/sentiment/:productId` | Product sentiment analysis |
| POST | `/api/v1/sentiment/analyze` | Analyze text sentiment |
| POST | `/api/v1/sentiment/batch` | Batch sentiment analysis |
| GET | `/api/v1/trust/product/:productId` | Product trust score |
| GET | `/api/v1/trust/vendor/:vendorId` | Vendor trust score |
| GET | `/api/v1/search/` | Full-text search with caching |
| GET | `/api/v1/search/suggestions` | Search autocomplete |
| GET | `/api/v1/search/trending` | Trending searches |
| POST | `/api/v1/admin/ingest` | Trigger platform scraping |
| POST | `/api/v1/admin/ingest/nairaland` | Scrape Nairaland discussions |
| POST | `/api/v1/admin/ingest/queue` | Queue scraping job |
| GET | `/api/v1/admin/ingestion/status` | Ingestion job status |
| GET | `/api/v1/admin/health` | System health check |
| DELETE | `/api/v1/admin/cache` | Clear cache |
| GET | `/health` | Basic health check |

## Nigerian Product Features

- **Condition Classification**: NEW, UK_USED (Tokunbo), FAIRLY_USED, REFURBISHED, OPEN_BOX
- **Brand Recognition**: Infinix, Tecno, Itel, Oraimo, and 25+ brands popular in Nigeria
- **Naira Price Handling**: ₦ formatting, price parsing, NGN currency
- **Trust Scoring**: 0-100 score with scam detection signals
- **Sentiment Analysis**: Nigerian pidgin awareness, scam signal detection

## Testing

```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
```

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript 5.3
- **Framework**: Fastify 4
- **Database**: PostgreSQL 16 + Prisma 5
- **Cache**: Redis 7 + ioredis
- **Queue**: BullMQ
- **Scraping**: Cheerio + Puppeteer
- **Validation**: Zod
- **Sentiment**: Python FastAPI + HuggingFace Transformers
- **Containerization**: Docker + Docker Compose
