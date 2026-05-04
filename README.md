# SaaS Finder

> Validated SaaS opportunities from Reddit, without the paid scraping or AI bills.

A free reimplementation of [Validly](https://github.com/Nova-Designs-Creative/validly): same idea — turn weekly Reddit discussions into scored SaaS ideas — but built on free, flexible plumbing.

## What changed vs Validly

| Layer | Validly | SaaS Finder |
|-------|---------|-------------|
| Reddit scraping | Decodo (paid scraping API) + Cheerio HTML parsing | Reddit's public JSON API (`*.json` endpoints), free |
| AI analysis | Insforge SDK | OpenRouter REST API (any model: GPT, Claude, Gemini, Llama, free models...) |
| Persistence | Optional Insforge table | None |

Same UX, same scored output, zero monthly cost beyond the model tokens you choose to spend on OpenRouter (and OpenRouter has free models too).

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Zod (input + AI output validation)
- jsonrepair (recovers malformed JSON from smaller models)
- OpenRouter chat completions (OpenAI-compatible)

## Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local and fill OPENROUTER_API_KEY
npm run dev
```

Open http://localhost:3000 and analyze any subreddit.

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OPENROUTER_API_KEY` | yes | — | Get one at [openrouter.ai/keys](https://openrouter.ai/keys) |
| `OPENROUTER_MODEL` | no | `openai/gpt-4o-mini` | Any [OpenRouter model id](https://openrouter.ai/models) |
| `OPENROUTER_APP_URL` | no | — | Sent as `HTTP-Referer` for OpenRouter analytics/ranking |
| `OPENROUTER_APP_NAME` | no | — | Sent as `X-Title` |
| `OPENROUTER_TIMEOUT_MS` | no | `90000` | Hard timeout on the AI call |
| `REDDIT_TIMEOUT_MS` | no | `15000` | Per-request timeout for Reddit |
| `REDDIT_USER_AGENT` | no | generic | Reddit asks for a descriptive UA — set yours to avoid throttling |

### Picking a model

OpenRouter exposes a single endpoint for hundreds of models. A few sane defaults:

- **Cheap & solid JSON**: `openai/gpt-4o-mini`, `google/gemini-2.0-flash-001`
- **Smarter, slower**: `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`
- **Free (rate-limited)**: `meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-chat-v3.1:free`

Smaller free models sometimes return slightly malformed JSON — that's why we keep `jsonrepair` in the loop.

## API

### `POST /api/analyze`

```json
{ "subreddit": "saas" }
```

Returns:

```json
{
  "subreddit": "saas",
  "source": {
    "subreddit": "saas",
    "scrapedAt": "2026-05-04T...",
    "posts": [
      {
        "title": "...",
        "permalink": "/r/saas/comments/.../",
        "threadUrl": "https://www.reddit.com/r/saas/comments/.../",
        "comments": ["...", "..."]
      }
    ]
  },
  "ideas": [
    {
      "idea_name": "...",
      "problem": "...",
      "demand_level": "High",
      "existing_solutions": ["..."],
      "similar_competitors": ["..."],
      "user_complaints": ["..."],
      "opportunity": "...",
      "monetization_model": "...",
      "pricing_hint": "...",
      "revenue_potential": "...",
      "go_to_market": "...",
      "score": 8,
      "verdict": "Strong",
      "source_threads": [
        { "title": "...", "thread_url": "https://www.reddit.com/..." }
      ]
    }
  ]
}
```

## How it works

1. `lib/reddit.ts` calls `https://www.reddit.com/r/{sub}/top.json?t=week&limit=25`, sorts posts by comment count, then fetches each thread's comments through the same JSON API in batches of 4. No HTML, no headless browser, no scraping vendor.
2. `lib/openrouter.ts` compacts the structured data, sends it to OpenRouter with a strict-JSON system prompt and `response_format: { type: "json_object" }`, then validates the result with Zod (recovering with `jsonrepair` if needed).
3. `app/api/analyze/route.ts` glues both together and exposes the JSON contract above.

## Project structure

```
saas-finder/
├── app/
│   ├── api/analyze/route.ts   # POST /api/analyze
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # UI
├── lib/
│   ├── env.ts                 # Zod-validated env (OpenRouter + Reddit)
│   ├── openrouter.ts          # AI analysis via OpenRouter
│   ├── reddit.ts              # Reddit JSON API client
│   └── types.ts
├── .env.example
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Notes & caveats

- Reddit's public JSON API isn't documented as a stable contract. Reddit may rate-limit aggressive callers — set `REDDIT_USER_AGENT` to something descriptive and don't hammer it. For heavier production usage, the [official Reddit API](https://www.reddit.com/dev/api) (free with OAuth) is the next step.
- Some hosts (Vercel edge, certain cloud egress IPs) get blocked by Reddit. If you see 403s in production, route through a region Reddit doesn't block, or swap the fetcher for the OAuth API.
- Output validation (`zod`) requires 3–10 ideas with full fields. If a model returns garbage, the route returns 500 with the parse error — try a stronger model.

## License

MIT — same as the original Validly.
