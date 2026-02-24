import crypto from "crypto";
import { redisClient } from "../config/redis.js";

const readClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }

  if (typeof req.ip === "string" && req.ip.trim().length > 0) {
    return req.ip.trim();
  }

  if (
    typeof req.connection?.remoteAddress === "string" &&
    req.connection.remoteAddress.trim().length > 0
  ) {
    return req.connection.remoteAddress.trim();
  }

  return "unknown-ip";
};

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const hashKey = (value) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

const createRedisRateLimiter = ({
  keyPrefix,
  limit,
  windowSeconds,
  message,
  keyBuilder,
}) => {
  return async (req, res, next) => {
    try {
      if (!redisClient.isOpen) {
        return next();
      }

      const keyPart = keyBuilder(req);
      const key = `${keyPrefix}:${keyPart}`;

      const count = await redisClient.incr(key);
      let ttl = await redisClient.ttl(key);

      if (ttl < 0) {
        await redisClient.expire(key, windowSeconds);
        ttl = windowSeconds;
      }

      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
      res.setHeader("X-RateLimit-Reset", String(Math.max(0, ttl)));

      if (count > limit) {
        return res.status(429).json({
          message,
        });
      }

      next();
    } catch (error) {
      console.error("Rate limiter error:", error.message);
      next();
    }
  };
};

const ipRateLimitKeyBuilder = (req) => hashKey(readClientIp(req));

const emailAndIpRateLimitKeyBuilder = (req) => {
  const email = normalizeEmail(req.body?.email || "");
  const ip = readClientIp(req);
  return hashKey(`${email || "missing-email"}:${ip}`);
};

export const signinIpRateLimiter = createRedisRateLimiter({
  keyPrefix: "ratelimit:signin:ip",
  limit: 20,
  windowSeconds: 10 * 60,
  message: "Too many login attempts. Please try again in a few minutes.",
  keyBuilder: ipRateLimitKeyBuilder,
});

export const signinIdentityRateLimiter = createRedisRateLimiter({
  keyPrefix: "ratelimit:signin:identity",
  limit: 8,
  windowSeconds: 10 * 60,
  message: "Too many login attempts for this account. Please wait and retry.",
  keyBuilder: emailAndIpRateLimitKeyBuilder,
});

export const signupIpRateLimiter = createRedisRateLimiter({
  keyPrefix: "ratelimit:signup:ip",
  limit: 10,
  windowSeconds: 60 * 60,
  message: "Too many signup attempts. Please try again later.",
  keyBuilder: ipRateLimitKeyBuilder,
});

export const signupIdentityRateLimiter = createRedisRateLimiter({
  keyPrefix: "ratelimit:signup:identity",
  limit: 5,
  windowSeconds: 60 * 60,
  message: "Too many signup attempts for this email. Please try later.",
  keyBuilder: emailAndIpRateLimitKeyBuilder,
});
