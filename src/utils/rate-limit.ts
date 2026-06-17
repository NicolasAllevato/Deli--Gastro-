import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------------------------------------------------------------------------
// In-memory fallback (development / no Upstash env vars)
// ---------------------------------------------------------------------------
const memoryStore = new Map<string, number[]>();

function rateLimitMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (memoryStore.get(key) ?? []).filter(t => now - t < windowMs);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  memoryStore.set(key, timestamps);
  return true;
}

// ---------------------------------------------------------------------------
// Upstash singleton (only created when env vars are present)
// ---------------------------------------------------------------------------
function createUpstashClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !url.startsWith("https://")) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

const upstashRedis: Redis | null = createUpstashClient();

// Cache Ratelimit instances so we don't recreate them on every request
const ratelimitCache = new Map<string, Ratelimit>();

function getRatelimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  const cached = ratelimitCache.get(cacheKey);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: upstashRedis as Redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
    analytics: false,
  });
  ratelimitCache.set(cacheKey, limiter);
  return limiter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the request is within the allowed rate, `false` if limited.
 *
 * - When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set → Upstash
 *   sliding-window rate limiter (works across Vercel serverless instances).
 * - Otherwise → in-memory Map fallback (suitable for local development).
 */
export async function rateLimit(
  identifier: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  if (!upstashRedis) {
    return rateLimitMemory(identifier, max, windowMs);
  }

  const limiter = getRatelimiter(max, windowMs);
  const { success } = await limiter.limit(identifier);
  return success;
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
