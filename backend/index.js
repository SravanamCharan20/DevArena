import express from "express";
import { connectDB } from "./config/db.js";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRouter from "./routes/authRoutes.js";
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

dotenv.config();
const PORT = process.env.PORT || 8888;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("Backend is Working ...✅");
});

app.use("/auth", authRouter);

const startServer = async () => {
  await connectDB();
  console.log("Connected to DB...");

  await connectRedis();
  const { pubClient, subClient } = await createRedisPubSubClients();
  io.adapter(createAdapter(pubClient, subClient));

  initSocket(io, redisClient);

  server.listen(PORT, () => {
    console.log(`Server is running at ${PORT}...`);
  });
};

startServer().catch((error) => {
  console.error("Startup error:", error.message);
  process.exit(1);
});
