import { getServerEnv } from "@/lib/env";
import { getRedditToken } from "@/lib/reddit-auth";
import type { RedditPost, StructuredRedditData } from "@/lib/types";

const LISTING_LIMIT = 40;
const DEFAULT_MAX_POSTS = 15;
const DEFAULT_MAX_COMMENTS = 5;

// Conservative pacing for anonymous; relaxed when OAuth is configured
// (Reddit allows 100 req/min/client_id with OAuth, ~10/min anonymous).
const COMMENT_FETCH_CONCURRENCY_ANON = 2;
const COMMENT_FETCH_CONCURRENCY_OAUTH = 4;
const SUBREDDIT_FETCH_CONCURRENCY_ANON = 1;
const SUBREDDIT_FETCH_CONCURRENCY_OAUTH = 2;
const COMMENT_BATCH_DELAY_ANON_MS = 350;
const COMMENT_BATCH_DELAY_OAUTH_MS = 80;
const SUB_BATCH_DELAY_ANON_MS = 600;
const SUB_BATCH_DELAY_OAUTH_MS = 150;

const MAX_TITLE_LENGTH = 200;
const MAX_COMMENT_LENGTH = 360;
const MIN_COMMENT_LENGTH = 24;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;
const MAX_RETRY_DELAY_MS = 15000;
const RATE_LIMIT_FLOOR = 5;

export type ScrapeLimits = {
  maxPosts?: number;
  maxComments?: number;
};

type RedditListing = {
  data?: {
    children?: Array<{
      kind?: string;
      data?: Record<string, unknown>;
    }>;
  };
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function toAbsoluteRedditUrl(href: string): string {
  if (/^https?:\/\//.test(href)) {
    return href;
  }
  return `https://www.reddit.com${href.startsWith("/") ? href : `/${href}`}`;
}

function normalizePermalink(href: string): string {
  const absoluteUrl = toAbsoluteRedditUrl(href);
  try {
    const url = new URL(absoluteUrl);
    return `${url.pathname.replace(/\/+$/, "")}/`;
  } catch {
    return absoluteUrl;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfterSec = retryAfterHeader
    ? parseInt(retryAfterHeader, 10)
    : NaN;
  const base =
    Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, MAX_RETRY_DELAY_MS)
      : Math.min(
          RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
          MAX_RETRY_DELAY_MS,
        );
  const jitter = Math.floor(Math.random() * 400);
  return base + jitter;
}

// Shared throttle state, populated from x-ratelimit-* response headers.
// Reddit returns these on every authenticated response; we use them to
// pre-emptively pause when remaining drops near zero.
let observedRateLimit: {
  remaining: number;
  resetAt: number;
} | null = null;

// In-memory response cache — avoids re-hitting Reddit when the user
// re-analyses the same subreddit within the TTL window. Especially
// valuable when running anonymously (rate-limited).
const RESPONSE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
type CacheEntry = { data: unknown; expiresAt: number };
const responseCache = new Map<string, CacheEntry>();

function getCachedResponse<T>(key: string): T | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setCachedResponse(key: string, data: unknown): void {
  // Cap cache size — drop oldest if over 200 entries
  if (responseCache.size > 200) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey !== undefined) responseCache.delete(firstKey);
  }
  responseCache.set(key, {
    data,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });
}

function updateRateLimitFromHeaders(headers: Headers): void {
  const remaining = parseFloat(headers.get("x-ratelimit-remaining") ?? "");
  const resetSec = parseFloat(headers.get("x-ratelimit-reset") ?? "");
  if (Number.isFinite(remaining) && Number.isFinite(resetSec)) {
    observedRateLimit = {
      remaining,
      resetAt: Date.now() + resetSec * 1000,
    };
  }
}

async function awaitRateLimitWindow(): Promise<void> {
  if (!observedRateLimit) return;
  if (observedRateLimit.remaining > RATE_LIMIT_FLOOR) return;
  const wait = observedRateLimit.resetAt - Date.now();
  if (wait > 0) await sleep(Math.min(wait + 250, MAX_RETRY_DELAY_MS));
}

function buildRedditUrl(pathAndQuery: string, useOAuth: boolean): string {
  // pathAndQuery is expected to start with '/' (e.g. '/r/saas/top.json?...')
  const base = useOAuth ? "https://oauth.reddit.com" : "https://www.reddit.com";
  return `${base}${pathAndQuery}`;
}

async function fetchRedditJson<T>(pathAndQuery: string): Promise<T> {
  // Cache lookup first — by path (so OAuth and anonymous share entries
  // since the JSON shape is identical).
  const cached = getCachedResponse<T>(pathAndQuery);
  if (cached !== null) return cached;

  const { redditUserAgent, redditTimeoutMs } = getServerEnv();
  const token = await getRedditToken();
  const url = buildRedditUrl(pathAndQuery, Boolean(token));

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    await awaitRateLimitWindow();

    try {
      const headers: Record<string, string> = {
        "User-Agent": redditUserAgent,
        Accept: "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(redditTimeoutMs),
      });

      updateRateLimitFromHeaders(response.headers);

      if (response.status === 429 || response.status === 503) {
        if (attempt < RETRY_ATTEMPTS) {
          await sleep(
            backoffDelay(attempt, response.headers.get("retry-after")),
          );
          continue;
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Reddit request failed (${response.status} ${response.statusText}) for ${url}: ${body.slice(0, 180)}`,
        );
      }

      const data = (await response.json()) as T;
      setCachedResponse(pathAndQuery, data);
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(backoffDelay(attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Reddit request failed: ${url}`);
}

type PostCandidate = {
  title: string;
  permalink: string;
  selftext: string;
  numComments: number;
  subreddit: string;
};

function extractPostCandidates(
  listing: RedditListing,
  fallbackSubreddit: string,
): PostCandidate[] {
  const children = listing?.data?.children ?? [];
  const candidates: PostCandidate[] = [];
  const seen = new Set<string>();

  for (const child of children) {
    if (child.kind && child.kind !== "t3") {
      continue;
    }
    const data = child.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (data.stickied) continue;

    const titleRaw = typeof data.title === "string" ? data.title : "";
    const permalinkRaw = typeof data.permalink === "string" ? data.permalink : "";
    const title = trimText(titleRaw, MAX_TITLE_LENGTH);
    const permalink = permalinkRaw ? normalizePermalink(permalinkRaw) : "";

    if (!title || !permalink || seen.has(permalink)) continue;
    seen.add(permalink);

    candidates.push({
      title,
      permalink,
      selftext: typeof data.selftext === "string" ? data.selftext : "",
      numComments: typeof data.num_comments === "number" ? data.num_comments : 0,
      subreddit:
        typeof data.subreddit === "string" && data.subreddit.length > 0
          ? data.subreddit
          : fallbackSubreddit,
    });
  }

  return candidates;
}

type CommentChild = {
  kind?: string;
  data?: {
    body?: string;
    stickied?: boolean;
    author?: string;
    score?: number;
    replies?: RedditListing | "";
  };
};

function collectComments(
  children: CommentChild[],
  collected: string[],
  seen: Set<string>,
  maxComments: number,
): void {
  for (const child of children) {
    if (collected.length >= maxComments) return;
    if (child.kind !== "t1") continue;
    const data = child.data;
    if (!data || data.stickied) continue;

    const body = typeof data.body === "string" ? data.body : "";
    const trimmed = trimText(body, MAX_COMMENT_LENGTH);

    if (
      trimmed &&
      trimmed.length >= MIN_COMMENT_LENGTH &&
      !/^(\[deleted\]|\[removed\])$/i.test(trimmed) &&
      !seen.has(trimmed)
    ) {
      seen.add(trimmed);
      collected.push(trimmed);
      if (collected.length >= maxComments) return;
    }

    const replies = data.replies;
    if (replies && typeof replies !== "string") {
      const nested = (replies.data?.children ?? []) as CommentChild[];
      collectComments(nested, collected, seen, maxComments);
    }
  }
}

async function fetchCommentsForPost(
  permalink: string,
  maxComments: number,
): Promise<string[]> {
  const path = `${permalink.replace(/\/+$/, "")}.json?limit=30&sort=top&depth=2`;

  try {
    const payload = await fetchRedditJson<unknown>(path);
    const listings = Array.isArray(payload) ? (payload as RedditListing[]) : [];
    const commentsListing = listings[1];
    const children = (commentsListing?.data?.children ?? []) as CommentChild[];

    const collected: string[] = [];
    collectComments(children, collected, new Set<string>(), maxComments);
    return collected;
  } catch (error) {
    console.warn(
      `[reddit] Failed to fetch comments for ${permalink}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return [];
  }
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  delayBetweenBatchesMs = 0,
): Promise<R[]> {
  const results: R[] = [];
  let isFirstBatch = true;
  for (let index = 0; index < items.length; index += concurrency) {
    if (!isFirstBatch && delayBetweenBatchesMs > 0) {
      await sleep(delayBetweenBatchesMs);
    }
    isFirstBatch = false;
    const chunk = items.slice(index, index + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item, offset) => mapper(item, index + offset)),
    );
    results.push(...chunkResults);
  }
  return results;
}

function normalizeSubredditName(name: string): string {
  return name.trim().replace(/^r\//i, "");
}

export async function structureRedditData(
  subreddit: string,
  limits: ScrapeLimits = {},
): Promise<RedditPost[]> {
  const normalized = normalizeSubredditName(subreddit);
  const maxPosts = limits.maxPosts ?? DEFAULT_MAX_POSTS;
  const maxComments = limits.maxComments ?? DEFAULT_MAX_COMMENTS;

  const listingPath = `/r/${normalized}/top.json?t=week&limit=${LISTING_LIMIT}`;
  const listing = await fetchRedditJson<RedditListing>(listingPath);
  const allCandidates = extractPostCandidates(listing, normalized);

  if (allCandidates.length === 0) {
    throw new Error(
      `No posts returned for r/${normalized}. The subreddit may be private, banned, or empty.`,
    );
  }

  const candidates = allCandidates
    .sort((a, b) => b.numComments - a.numComments)
    .slice(0, maxPosts);

  const oauthAvailable = Boolean(await getRedditToken());
  const concurrency = oauthAvailable
    ? COMMENT_FETCH_CONCURRENCY_OAUTH
    : COMMENT_FETCH_CONCURRENCY_ANON;
  const batchDelay = oauthAvailable
    ? COMMENT_BATCH_DELAY_OAUTH_MS
    : COMMENT_BATCH_DELAY_ANON_MS;

  const posts = await mapInBatches(
    candidates,
    concurrency,
    async (candidate): Promise<RedditPost> => {
      const comments = await fetchCommentsForPost(
        candidate.permalink,
        maxComments,
      );

      const enriched =
        comments.length === 0 && candidate.selftext
          ? [trimText(candidate.selftext, MAX_COMMENT_LENGTH)]
          : comments;

      return {
        title: candidate.title,
        comments: enriched.filter(Boolean),
        permalink: candidate.permalink,
        threadUrl: toAbsoluteRedditUrl(candidate.permalink),
        subreddit: candidate.subreddit,
      };
    },
    batchDelay,
  );

  return posts;
}

function computeMultiLimits(count: number): Required<ScrapeLimits> {
  if (count <= 1) return { maxPosts: 15, maxComments: 5 };
  if (count === 2) return { maxPosts: 10, maxComments: 4 };
  if (count === 3) return { maxPosts: 8, maxComments: 4 };
  if (count === 4) return { maxPosts: 6, maxComments: 3 };
  return { maxPosts: 5, maxComments: 3 };
}

export async function structureMultiRedditData(
  subreddits: string[],
  overrideLimits?: ScrapeLimits,
): Promise<StructuredRedditData> {
  const cleaned = Array.from(
    new Set(subreddits.map(normalizeSubredditName).filter(Boolean)),
  );

  if (cleaned.length === 0) {
    throw new Error("At least one subreddit is required.");
  }

  const auto = computeMultiLimits(cleaned.length);
  const limits: Required<ScrapeLimits> = {
    maxPosts: overrideLimits?.maxPosts ?? auto.maxPosts,
    maxComments: overrideLimits?.maxComments ?? auto.maxComments,
  };

  const oauthAvailable = Boolean(await getRedditToken());
  const subConcurrency = oauthAvailable
    ? SUBREDDIT_FETCH_CONCURRENCY_OAUTH
    : SUBREDDIT_FETCH_CONCURRENCY_ANON;
  const subBatchDelay = oauthAvailable
    ? SUB_BATCH_DELAY_OAUTH_MS
    : SUB_BATCH_DELAY_ANON_MS;

  const grouped = await mapInBatches(
    cleaned,
    subConcurrency,
    async (sub) => {
      try {
        const posts = await structureRedditData(sub, limits);
        return { sub, posts, error: null as string | null };
      } catch (err) {
        return {
          sub,
          posts: [] as RedditPost[],
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    subBatchDelay,
  );

  const failures = grouped.filter((g) => g.error);
  const succeeded = grouped.filter((g) => !g.error);

  if (succeeded.length === 0) {
    const reasons = failures
      .map((f) => `r/${f.sub}: ${f.error}`)
      .join(" | ");
    throw new Error(
      `Could not pull any subreddit. ${reasons || "All requests failed."}`,
    );
  }

  const posts = succeeded.flatMap((g) => g.posts);

  if (posts.length === 0) {
    throw new Error("No posts could be collected from the provided subreddits.");
  }

  return {
    subreddits: cleaned,
    scrapedAt: new Date().toISOString(),
    posts,
  };
}
