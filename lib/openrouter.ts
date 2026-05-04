import { jsonrepair } from "jsonrepair";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import type { SaasIdea, StructuredRedditData } from "@/lib/types";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const AI_POST_HARD_LIMIT = 30;
const AI_COMMENT_HARD_LIMIT = 5;
const MAX_SOURCES_PER_IDEA = 8;

const sourceThreadSchema = z.object({
  title: z.string().trim().min(1),
  thread_url: z.string().trim().url(),
});

const ideaSchema = z.object({
  idea_name: z.string().trim().min(1),
  problem: z.string().trim().min(1),
  demand_level: z.enum(["Low", "Medium", "High"]),
  existing_solutions: z.array(z.string().trim()).default([]),
  similar_competitors: z.array(z.string().trim()).default([]),
  user_complaints: z.array(z.string().trim()).default([]),
  opportunity: z.string().trim().min(1),
  monetization_model: z.string().trim().min(1),
  pricing_hint: z.string().trim().min(1),
  revenue_potential: z.string().trim().min(1),
  go_to_market: z.string().trim().min(1),
  score: z.coerce.number().min(0).max(10),
  verdict: z.enum(["Weak", "Decent", "Strong"]),
  source_threads: z.array(sourceThreadSchema).min(1).max(MAX_SOURCES_PER_IDEA),
});

const ideaArraySchema = z.array(ideaSchema).min(3).max(10);
const wrappedSchema = z.object({ ideas: ideaArraySchema });

const SYSTEM_PROMPT = `You are an expert startup analyst specializing in finding repeated, validated SaaS opportunities from real user discussions.

You will receive Reddit threads and their top comments from ONE OR MORE subreddits. Each post object includes a "subreddit" field telling you exactly where it came from. Your job is to CLUSTER recurring pain points across all of these threads and extract VALIDATED SaaS opportunities.

================================================================================
CRITICAL RULES — READ CAREFULLY
================================================================================

1. CLUSTER, DO NOT DUPLICATE.
   Many threads describe the SAME underlying problem in different words.
   You MUST merge them into a single idea. Do NOT return two ideas with the
   same root cause or target user.

2. RECURRENCE IS THE STRONGEST SIGNAL.
   The more threads cite the same pain point, the higher its score and demand.
   When in doubt, prefer ideas backed by 3+ source threads to ideas backed by 1.

3. CROSS-SUBREDDIT PAIN = STRONGEST POSSIBLE VALIDATION.
   When the same pain point appears in MULTIPLE different subreddits, it is the
   strongest possible market signal. Such ideas should automatically get a
   "Strong" verdict and a high score (8-10), provided the threads genuinely
   describe the same problem (not just superficially similar).

4. CITE EVERY THREAD THAT EVIDENCES AN IDEA.
   For each idea, list ALL relevant source threads from the input data
   (up to ${MAX_SOURCES_PER_IDEA}). Use the EXACT thread title and EXACT
   thread_url from the input. Never invent threads.

5. RETURN BETWEEN 5 AND 8 IDEAS.
   Quality over quantity. If you can only justify 4 strong clusters, return 4.

6. ALL INSIGHTS MUST BE GROUNDED IN THE PROVIDED DATA.
   No prior knowledge. No invented quotes. No speculation.

================================================================================
PROCESS
================================================================================

Step 1: Read all titles + comments across every subreddit. Identify every
        distinct frustration, unmet need, workflow gap, or repeated request.

Step 2: Group similar pain points into clusters. Two pain points belong in
        the same cluster if a single product would solve both, even if they
        come from different subreddits.

Step 3: For each cluster with enough evidence (ideally 2+ threads), define:
        - The underlying problem
        - The recurring user complaints
        - The existing solutions and why they fall short
        - A SaaS that would solve it
        - Pricing and go-to-market

Step 4: Score each idea 1-10 based on:
        - CROSS-SUBREDDIT recurrence (highest weight — same pain in different
          communities means broad-market validation)
        - Recurrence within a single subreddit
        - Severity of pain expressed
        - Willingness to pay signals (money, lost time, lost revenue)
        - Realistic opportunity size

Step 5: Output as the strict JSON below.

================================================================================
OUTPUT FORMAT — strict JSON object, nothing else
================================================================================

{
  "ideas": [
    {
      "idea_name": "concise product name",
      "problem": "the underlying recurring problem in 1-2 sentences",
      "demand_level": "Low | Medium | High",
      "existing_solutions": ["..."],
      "similar_competitors": ["..."],
      "user_complaints": ["short verbatim or paraphrased complaints, one per item"],
      "opportunity": "what to build and why it wins",
      "monetization_model": "e.g. monthly SaaS, usage-based, lifetime, etc.",
      "pricing_hint": "e.g. $19-49/mo per user",
      "revenue_potential": "realistic ceiling and reasoning",
      "go_to_market": "first wedge — channel, ICP, hook",
      "score": 0,
      "verdict": "Weak | Decent | Strong",
      "source_threads": [
        { "title": "exact title", "thread_url": "https://www.reddit.com/..." }
      ]
    }
  ]
}

NO text before or after the JSON. NO markdown fences. NO commentary.`;

function compactStructuredData(data: StructuredRedditData) {
  return {
    subreddits: data.subreddits,
    scrapedAt: data.scrapedAt,
    posts: data.posts.slice(0, AI_POST_HARD_LIMIT).map((post) => ({
      subreddit: post.subreddit,
      title: post.title,
      thread_url: post.threadUrl,
      comments: post.comments.slice(0, AI_COMMENT_HARD_LIMIT),
    })),
  };
}

function extractMessageContent(response: unknown): string {
  const record = response as Record<string, unknown>;
  const choices = record?.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "text" in (part as Record<string, unknown>)
        ) {
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join("\n");
  }

  throw new Error(
    "OpenRouter response did not contain a readable message payload.",
  );
}

function parseIdeas(raw: string): SaasIdea[] {
  const cleaned = raw.replace(/```json|```/gi, "").trim();

  const tryObject = (candidate: string): SaasIdea[] | null => {
    try {
      const parsed = JSON.parse(candidate);
      const wrapped = wrappedSchema.safeParse(parsed);
      if (wrapped.success) return wrapped.data.ideas;
      const direct = ideaArraySchema.safeParse(parsed);
      if (direct.success) return direct.data;
    } catch {
      /* fallthrough */
    }
    return null;
  };

  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    const candidate = cleaned.slice(objectStart, objectEnd + 1);
    const parsed = tryObject(candidate);
    if (parsed) return parsed;

    try {
      const repaired = jsonrepair(candidate);
      const reparsed = tryObject(repaired);
      if (reparsed) return reparsed;
    } catch {
      /* fallthrough */
    }
  }

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const candidate = cleaned.slice(arrayStart, arrayEnd + 1);
    try {
      return ideaArraySchema.parse(JSON.parse(candidate));
    } catch {
      try {
        return ideaArraySchema.parse(JSON.parse(jsonrepair(candidate)));
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? `Failed to parse OpenRouter JSON: ${err.message}`
            : "Failed to parse OpenRouter JSON.",
        );
      }
    }
  }

  throw new Error(
    "OpenRouter response did not include a JSON object or array.",
  );
}

export async function analyzeWithAI(
  data: StructuredRedditData,
): Promise<SaasIdea[]> {
  const env = getServerEnv();
  const compact = compactStructuredData(data);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.openrouterApiKey}`,
  };
  if (env.openrouterAppUrl) headers["HTTP-Referer"] = env.openrouterAppUrl;
  if (env.openrouterAppName) headers["X-Title"] = env.openrouterAppName;

  const body = {
    model: env.openrouterModel,
    temperature: 0.2,
    max_tokens: 4500,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: JSON.stringify(compact) },
    ],
  };

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(env.openrouterTimeoutMs),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${response.status} ${response.statusText}): ${errorBody.slice(0, 240)}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const rawContent = extractMessageContent(payload);
  return parseIdeas(rawContent);
}
