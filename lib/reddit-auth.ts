import { getServerEnv } from "@/lib/env";

const TOKEN_ENDPOINT = "https://www.reddit.com/api/v1/access_token";
const REFRESH_BUFFER_MS = 60_000;

type CachedToken = {
  token: string;
  expiresAt: number;
};

let cached: CachedToken | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * Returns a Reddit OAuth bearer token if REDDIT_CLIENT_ID is configured,
 * otherwise null (caller should fall back to anonymous access).
 *
 * Uses Reddit's "Application Only" flow:
 *   - If REDDIT_CLIENT_SECRET is set → grant_type=client_credentials
 *     (works for "web" / "script" apps registered with a secret).
 *   - If only REDDIT_CLIENT_ID is set → grant_type=installed_client
 *     (works for "installed" apps without a secret; no user account needed).
 *
 * Both grants return an access_token good for ~1h, used against
 * https://oauth.reddit.com which permits 100 requests/min per OAuth client.
 *
 * Tokens are cached in memory until ~1 minute before expiry.
 */
export async function getRedditToken(): Promise<string | null> {
  const env = getServerEnv();
  if (!env.redditClientId) return null;

  if (cached && Date.now() < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.token;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const auth = Buffer.from(
        `${env.redditClientId}:${env.redditClientSecret ?? ""}`,
      ).toString("base64");

      const params = new URLSearchParams();
      if (env.redditClientSecret) {
        params.set("grant_type", "client_credentials");
      } else {
        params.set(
          "grant_type",
          "https://oauth.reddit.com/grants/installed_client",
        );
        params.set("device_id", "DO_NOT_TRACK_THIS_DEVICE");
      }

      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": env.redditUserAgent,
          Accept: "application/json",
        },
        body: params.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Reddit OAuth failed (${response.status} ${response.statusText}): ${body.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
        error?: string;
      };

      if (!data.access_token) {
        throw new Error(
          `Reddit OAuth response missing access_token: ${JSON.stringify(data).slice(0, 200)}`,
        );
      }

      const expiresInMs =
        typeof data.expires_in === "number"
          ? data.expires_in * 1000
          : 3_600_000;

      cached = {
        token: data.access_token,
        expiresAt: Date.now() + expiresInMs,
      };

      return cached.token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearRedditTokenCache(): void {
  cached = null;
}
