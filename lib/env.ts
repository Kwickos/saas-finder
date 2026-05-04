import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.replace(/\/+$/, "") : undefined))
  .refine((value) => !value || /^https?:\/\//.test(value), {
    message: "Expected a valid URL",
  });

const serverEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().trim().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().trim().optional(),
  OPENROUTER_APP_URL: optionalUrl,
  OPENROUTER_APP_NAME: z.string().trim().optional(),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  REDDIT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  REDDIT_USER_AGENT: z.string().trim().optional(),
});

export type ServerEnv = {
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterAppUrl?: string;
  openrouterAppName?: string;
  openrouterTimeoutMs: number;
  redditTimeoutMs: number;
  redditUserAgent: string;
};

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.parse({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL,
    OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
    OPENROUTER_TIMEOUT_MS: process.env.OPENROUTER_TIMEOUT_MS,
    REDDIT_TIMEOUT_MS: process.env.REDDIT_TIMEOUT_MS,
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
  });

  cachedEnv = {
    openrouterApiKey: parsed.OPENROUTER_API_KEY,
    openrouterModel: parsed.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    openrouterAppUrl: parsed.OPENROUTER_APP_URL,
    openrouterAppName: parsed.OPENROUTER_APP_NAME,
    openrouterTimeoutMs: parsed.OPENROUTER_TIMEOUT_MS ?? 90000,
    redditTimeoutMs: parsed.REDDIT_TIMEOUT_MS ?? 15000,
    redditUserAgent:
      parsed.REDDIT_USER_AGENT ||
      "saas-finder/0.1 (+https://github.com/yourusername/saas-finder)",
  };

  return cachedEnv;
}
