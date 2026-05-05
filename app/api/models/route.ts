import { NextResponse } from "next/server";

import type {
  CuratedModel,
  ModelTier,
  ModelsResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 1800; // 30 min

type ORModel = {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  context_length?: number;
};

type ORResponse = { data: ORModel[] };

const FAMILY_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "meta-llama/",
  "mistralai/",
  "deepseek/",
  "qwen/",
  "x-ai/",
  "microsoft/",
  "nousresearch/",
  "perplexity/",
];

// Drop legacy / niche / vision-only models
const EXCLUDE_RE =
  /davinci|text-(ada|babbage|curie|davinci)|gpt-3\.5|gpt-4-turbo|gpt-4-32k|claude-2|claude-instant|palm-|gemini-pro$|gemma-(2b|7b)/i;

let cache: { data: ModelsResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

function tierOf(price: number): ModelTier {
  if (price === 0) return "free";
  if (price < 1) return "cheap";
  if (price <= 5) return "mid";
  return "premium";
}

function priceToPerMillion(value: string | number | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Number((n * 1_000_000).toFixed(3));
}

export async function GET() {
  if (cache && Date.now() < cache.expiresAt) {
    return NextResponse.json(cache.data);
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `OpenRouter ${response.status}` },
        { status: 502 },
      );
    }

    const json = (await response.json()) as ORResponse;

    const curated: CuratedModel[] = [];
    for (const m of json.data ?? []) {
      if (!m.id) continue;
      if (!FAMILY_PREFIXES.some((p) => m.id.startsWith(p))) continue;
      if (EXCLUDE_RE.test(m.id)) continue;

      const inputPrice = priceToPerMillion(m.pricing?.prompt);
      const outputPrice = priceToPerMillion(m.pricing?.completion);

      curated.push({
        id: m.id,
        name: m.name || m.id,
        inputPrice,
        outputPrice,
        contextLength: m.context_length ?? 0,
      });
    }

    const tiers: Record<ModelTier, CuratedModel[]> = {
      free: [],
      cheap: [],
      mid: [],
      premium: [],
    };
    for (const c of curated) {
      tiers[tierOf(c.inputPrice)].push(c);
    }

    for (const t of Object.keys(tiers) as ModelTier[]) {
      tiers[t].sort(
        (a, b) =>
          a.inputPrice - b.inputPrice || a.name.localeCompare(b.name),
      );
    }

    const data: ModelsResponse = {
      tiers,
      fetchedAt: new Date().toISOString(),
    };
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
