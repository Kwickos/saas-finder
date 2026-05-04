import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeWithAI } from "@/lib/openrouter";
import { structureMultiRedditData } from "@/lib/reddit";

export const runtime = "nodejs";
export const maxDuration = 60;

const subredditSchema = z
  .string()
  .trim()
  .min(1, "Subreddit is required")
  .max(50, "Subreddit is too long")
  .regex(/^[A-Za-z0-9_]+$/, "Use a subreddit name without /r/ or spaces");

const requestSchema = z
  .object({
    subreddits: z.array(subredditSchema).min(1).max(5).optional(),
    subreddit: subredditSchema.optional(),
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

    const source = await structureMultiRedditData(subreddits);
    const ideas = await analyzeWithAI(source);

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
