import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getServerEnv();
    return NextResponse.json({
      reddit: {
        oauth: Boolean(env.redditClientId),
        rateLimit: env.redditClientId ? "100/min" : "~10/min",
      },
    });
  } catch {
    // env validation might fail (e.g. missing OPENROUTER_API_KEY).
    // Status is best-effort; return empty instead of 500.
    return NextResponse.json({ reddit: { oauth: false, rateLimit: "~10/min" } });
  }
}
