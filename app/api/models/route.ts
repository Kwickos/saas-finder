import { NextResponse } from "next/server";

import type {
  CuratedModel,
  ModelTier,
  ModelsResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 1800; // 30 min

type ORArchitecture = {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
  instruct_type?: string | null;
};

type ORModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  deprecation_date?: string | null;
  architecture?: ORArchitecture;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  context_length?: number;
  supported_features?: string[];
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

// Legacy / niche / version-specific models we never want to surface.
const EXCLUDE_LEGACY_RE =
  /davinci|text-(ada|babbage|curie|davinci)|gpt-3\.5|gpt-4-turbo|gpt-4-32k|claude-2|claude-instant|palm-|gemini-pro$|gemma-(2b|7b)/i;

// Specialist models that output text but aren't general-purpose chat:
// code-only assistants, safety/guardrail classifiers, embedding models,
// audio I/O, image generators, raw base / completion checkpoints.
const EXCLUDE_SPECIALIST_RE =
  /(coder?|codex|codestral|devstral|code-instruct|guard|safeguard|moderat|safety|embed(ding)?|whisper|tts|voice|audio|dall-?e|sora|imagen|stable-diffusion|flux|midjourney|-image[-:]?\d|-vision-only|-base$|-completion$|prompt-?guard)/i;

const MAX_PER_TIER = 5;

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

function familyOf(id: string): string {
  for (const p of FAMILY_PREFIXES) {
    if (id.startsWith(p)) return p;
  }
  return "other/";
}

function isDeprecated(deprecation: string | null | undefined): boolean {
  if (!deprecation) return false;
  const t = Date.parse(deprecation);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

type Working = CuratedModel & {
  family: string;
  created: number;
  supportsJson: boolean;
};

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

    const eligible: Working[] = [];
    for (const m of json.data ?? []) {
      if (!m.id) continue;
      if (!FAMILY_PREFIXES.some((p) => m.id.startsWith(p))) continue;
      if (EXCLUDE_LEGACY_RE.test(m.id)) continue;
      if (EXCLUDE_SPECIALIST_RE.test(m.id)) continue;
      if (isDeprecated(m.deprecation_date)) continue;

      // Architecture: text-only I/O (no image/audio outputs).
      const arch = m.architecture;
      const outputs = arch?.output_modalities ?? ["text"];
      const inputs = arch?.input_modalities ?? ["text"];
      if (!inputs.includes("text")) continue;
      if (!outputs.includes("text")) continue;
      if (outputs.some((o) => o !== "text")) continue;

      const inputPrice = priceToPerMillion(m.pricing?.prompt);
      const outputPrice = priceToPerMillion(m.pricing?.completion);
      const features = m.supported_features ?? [];

      eligible.push({
        id: m.id,
        name: m.name || m.id,
        inputPrice,
        outputPrice,
        contextLength: m.context_length ?? 0,
        family: familyOf(m.id),
        created: m.created ?? 0,
        supportsJson:
          features.includes("json_mode") ||
          features.includes("structured_outputs"),
      });
    }

    // For each tier, group by family and keep only the newest model per
    // family. Then sort by recency and cap at MAX_PER_TIER. This guarantees
    // family diversity (not 5 OpenAI models filling the tier) and recency
    // (most current generation first).
    const tiers: Record<ModelTier, CuratedModel[]> = {
      free: [],
      cheap: [],
      mid: [],
      premium: [],
    };

    const allTiers: ModelTier[] = ["free", "cheap", "mid", "premium"];
    for (const tier of allTiers) {
      const inTier = eligible.filter(
        (m) => tierOf(m.inputPrice) === tier,
      );

      const byFamily = new Map<string, Working>();
      for (const m of inTier) {
        const existing = byFamily.get(m.family);
        if (!existing) {
          byFamily.set(m.family, m);
          continue;
        }
        // Prefer json-capable; tie-break by recency.
        const challengerBetter =
          (m.supportsJson && !existing.supportsJson) ||
          (m.supportsJson === existing.supportsJson &&
            m.created > existing.created);
        if (challengerBetter) byFamily.set(m.family, m);
      }

      const ranked = Array.from(byFamily.values())
        .sort((a, b) => {
          // json-capable first, then by recency desc, then alphabetical.
          if (a.supportsJson !== b.supportsJson) {
            return a.supportsJson ? -1 : 1;
          }
          if (a.created !== b.created) return b.created - a.created;
          return a.name.localeCompare(b.name);
        })
        .slice(0, MAX_PER_TIER);

      tiers[tier] = ranked.map(({ family: _f, created: _c, supportsJson: _s, ...rest }) => {
        void _f;
        void _c;
        void _s;
        return rest;
      });
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
