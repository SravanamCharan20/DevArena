import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisClient = createClient({ url: REDIS_URL });

redisClient.on("error", (err) => {
  console.error("Redis client error:", err.message);
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Connected to Redis...");
  }
};

export const createRedisPubSubClients = async () => {
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => {
    console.error("Redis pub client error:", err.message);
  });

  subClient.on("error", (err) => {
    console.error("Redis sub client error:", err.message);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  return { pubClient, subClient };
};
