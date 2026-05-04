import { getServerEnv } from "@/lib/env";
import type { RedditPost, StructuredRedditData } from "@/lib/types";

const LISTING_LIMIT = 40;
const DEFAULT_MAX_POSTS = 15;
const DEFAULT_MAX_COMMENTS = 5;
const COMMENT_FETCH_CONCURRENCY = 5;
const SUBREDDIT_FETCH_CONCURRENCY = 3;
const MAX_TITLE_LENGTH = 200;
const MAX_COMMENT_LENGTH = 360;
const MIN_COMMENT_LENGTH = 24;
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1200;

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

async function fetchRedditJson<T>(url: string): Promise<T> {
  const { redditUserAgent, redditTimeoutMs } = getServerEnv();

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": redditUserAgent,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(redditTimeoutMs),
      });

      if (response.status === 429 || response.status === 503) {
        if (attempt < RETRY_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Reddit request failed (${response.status} ${response.statusText}) for ${url}: ${body.slice(0, 180)}`,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
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
  const url = `https://www.reddit.com${permalink}.json?limit=30&sort=top&depth=2`;

  try {
    const payload = await fetchRedditJson<unknown>(url);
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
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
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

  const listingUrl = `https://www.reddit.com/r/${normalized}/top.json?t=week&limit=${LISTING_LIMIT}`;
  const listing = await fetchRedditJson<RedditListing>(listingUrl);
  const allCandidates = extractPostCandidates(listing, normalized);

  if (allCandidates.length === 0) {
    throw new Error(
      `No posts returned for r/${normalized}. The subreddit may be private, banned, or empty.`,
    );
  }

  const candidates = allCandidates
    .sort((a, b) => b.numComments - a.numComments)
    .slice(0, maxPosts);

  const posts = await mapInBatches(
    candidates,
    COMMENT_FETCH_CONCURRENCY,
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
): Promise<StructuredRedditData> {
  const cleaned = Array.from(
    new Set(subreddits.map(normalizeSubredditName).filter(Boolean)),
  );

  if (cleaned.length === 0) {
    throw new Error("At least one subreddit is required.");
  }

  const limits = computeMultiLimits(cleaned.length);

  const grouped = await mapInBatches(
    cleaned,
    SUBREDDIT_FETCH_CONCURRENCY,
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
