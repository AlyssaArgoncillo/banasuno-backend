/**
 * Redis client for banasuno-backend.
 * Uses REDIS_URL (default: redis://localhost:6379).
 */

import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err) => console.error("[Redis]", err.message));
redis.on("connect", () => console.log("[Redis] connected"));
