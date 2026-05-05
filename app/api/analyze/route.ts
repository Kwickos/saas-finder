import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeWithAI } from "@/lib/openrouter";
import { structureMultiRedditData } from "@/lib/reddit";
import { SETTINGS_LIMITS } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const subredditSchema = z
  .string()
  .trim()
  .min(1, "Subreddit is required")
  .max(50, "Subreddit is too long")
  .regex(/^[A-Za-z0-9_]+$/, "Use a subreddit name without /r/ or spaces");

const settingsSchema = z
  .object({
    postsPerSubreddit: z.coerce
      .number()
      .int()
      .min(SETTINGS_LIMITS.postsPerSubreddit.min)
      .max(SETTINGS_LIMITS.postsPerSubreddit.max)
      .optional(),
    commentsPerPost: z.coerce
      .number()
      .int()
      .min(SETTINGS_LIMITS.commentsPerPost.min)
      .max(SETTINGS_LIMITS.commentsPerPost.max)
      .optional(),
    language: z.enum(["en", "fr", "es", "de", "pt", "it"]).optional(),
    model: z
      .string()
      .trim()
      .max(100)
      .regex(/^[A-Za-z0-9/_:.\-]+$/, "Invalid model id")
      .optional(),
  })
  .optional();

const requestSchema = z
  .object({
    subreddits: z.array(subredditSchema).min(1).max(5).optional(),
    subreddit: subredditSchema.optional(),
    settings: settingsSchema,
  })
  .refine((v) => Boolean(v.subreddits?.length || v.subreddit), {
    message: "Provide at least one subreddit.",
  });

function getErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid request payload.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected server error.";
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.parse(await request.json());
    const subreddits =
      parsed.subreddits && parsed.subreddits.length > 0
        ? parsed.subreddits
        : [parsed.subreddit!];

    const overrideLimits =
      parsed.settings?.postsPerSubreddit || parsed.settings?.commentsPerPost
        ? {
            maxPosts: parsed.settings.postsPerSubreddit,
            maxComments: parsed.settings.commentsPerPost,
          }
        : undefined;

    const source = await structureMultiRedditData(subreddits, overrideLimits);

    const signalCount = source.posts.filter((p) => p.comments.length > 0).length;
    const minSignal = Math.max(3, Math.ceil(source.posts.length * 0.3));
    if (signalCount < minSignal) {
      throw new Error(
        `Reddit rate-limited us (${signalCount}/${source.posts.length} posts had usable content). Wait ~30 seconds and retry, or lower "Posts per subreddit" / "Comments per post" in settings.`,
      );
    }

    const ideas = await analyzeWithAI(
      source,
      parsed.settings?.language ?? "en",
      parsed.settings?.model,
    );

    return NextResponse.json({
      subreddits: source.subreddits,
      source,
      ideas,
    });
  } catch (error) {
    console.error("[api/analyze]", error);
    const message = getErrorMessage(error);
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
