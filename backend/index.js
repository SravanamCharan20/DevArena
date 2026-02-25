import express from "express";
import mongoose from "mongoose";
import { connectDB } from "./config/db.js";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRouter from "./routes/authRoutes.js";
import contestRouter from "./routes/contestRoutes.js";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { initSocket } from "./sockets/index.js";
import {
  connectRedis,
  redisClient,
  createRedisPubSubClients,
} from "./config/redis.js";
import {
  ensureRunCodeQueueReady,
  getRunCodeQueueHealth,
  registerRunCodeQueueHandlers,
} from "./services/judge/queue.js";

dotenv.config();
const PORT = process.env.PORT || 8888;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const app = express();
const server = http.createServer(app);
let redisPubClient = null;
let redisSubClient = null;

const mongoReadyStateLabel = (readyState) => {
  switch (readyState) {
    case 0:
      return "disconnected";
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "unknown";
  }
};

const buildOperationalSnapshot = async () => {
  const queue = await getRunCodeQueueHealth();
  const mongoReadyState = Number(mongoose.connection?.readyState ?? 0);

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV || "development",
    mongo: {
      readyState: mongoReadyState,
      status: mongoReadyStateLabel(mongoReadyState),
      ok: mongoReadyState === 1,
    },
    redis: {
      appClient: {
        isOpen: Boolean(redisClient.isOpen),
        isReady: Boolean(redisClient.isReady),
      },
      pubClient: redisPubClient
        ? {
            isOpen: Boolean(redisPubClient.isOpen),
            isReady: Boolean(redisPubClient.isReady),
          }
        : null,
      subClient: redisSubClient
        ? {
            isOpen: Boolean(redisSubClient.isOpen),
            isReady: Boolean(redisSubClient.isReady),
          }
        : null,
      ok: Boolean(redisClient.isOpen && redisClient.isReady),
    },
    queue,
  };
};

if (process.env.TRUST_PROXY) {
  const trustProxyValue =
    process.env.TRUST_PROXY === "true"
      ? 1
      : Number.isNaN(Number(process.env.TRUST_PROXY))
        ? process.env.TRUST_PROXY
        : Number(process.env.TRUST_PROXY);
  app.set("trust proxy", trustProxyValue);
}

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("Backend is Working ...✅");
});

app.get("/healthz", async (_req, res) => {
  const snapshot = await buildOperationalSnapshot();
  return res.status(200).json({
    ok: true,
    status: "alive",
    timestamp: snapshot.timestamp,
    uptimeSeconds: snapshot.uptimeSeconds,
  });
});

app.get("/readyz", async (_req, res) => {
  const snapshot = await buildOperationalSnapshot();
  const ready =
    snapshot.mongo.ok === true &&
    snapshot.redis.ok === true &&
    snapshot.queue.ok === true;

  return res.status(ready ? 200 : 503).json({
    ok: ready,
    status: ready ? "ready" : "not_ready",
    snapshot,
  });
});

app.get("/ops/status", async (_req, res) => {
  const snapshot = await buildOperationalSnapshot();
  return res.status(200).json({
    ok: true,
    snapshot,
  });
});

app.use("/auth", authRouter);
app.use("/contest", contestRouter);

const startServer = async () => {
  await connectDB();
  console.log("Connected to DB...");

  await connectRedis();
  const { pubClient, subClient } = await createRedisPubSubClients();
  redisPubClient = pubClient;
  redisSubClient = subClient;
  io.adapter(createAdapter(pubClient, subClient));
  await ensureRunCodeQueueReady();
  registerRunCodeQueueHandlers({ io });

  initSocket(io, redisClient);

  server.listen(PORT, () => {
    console.log(`Server is running at ${PORT}...`);
  });
};

startServer().catch((error) => {
  console.error("Startup error:", error.message);
  process.exit(1);
});
