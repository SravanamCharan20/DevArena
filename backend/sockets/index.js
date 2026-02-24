import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const ROOM_TTL_SECONDS = 60 * 60 * 6;
const CONTEST_COUNTDOWN_MS = 3000;

const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, code, message });

const guestNameFromSocketId = (socketId) => `guest-${socketId.slice(0, 6)}`;
const getSocketName = (socket) =>
  socket.data?.user?.username || guestNameFromSocketId(socket.id);

const generateRoomCode = () => randomUUID().split("-")[0].toUpperCase();
const normalizeRoomCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const getCookieValue = (cookieHeader = "", key) => {
  const part = cookieHeader
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${key}=`));
  if (!part) return "";
  return decodeURIComponent(part.slice(key.length + 1));
};

const roomMetaKey = (roomCode) => `room:${roomCode}:meta`;
const roomMembersKey = (roomCode) => `room:${roomCode}:members`;
const roomUserSocketsKey = (roomCode, userId) =>
  `room:${roomCode}:user:${userId}:sockets`;
const socketRoomsKey = (socketId) => `socket:${socketId}:rooms`;

const toMember = (socket, ready = false) => ({
  userId: socket.data.user.id,
  username: socket.data.user.username,
  ready,
});

const getRoomMeta = async (redis, roomCode) => {
  const raw = await redis.get(roomMetaKey(roomCode));
  return raw ? JSON.parse(raw) : null;
};

const getRoomMembers = async (redis, roomCode) => {
  const map = await redis.hGetAll(roomMembersKey(roomCode));
  return Object.values(map).map((value) => JSON.parse(value));
};

const setRoomMeta = async (redis, roomCode, roomMeta) => {
  await redis.set(roomMetaKey(roomCode), JSON.stringify(roomMeta), {
    EX: ROOM_TTL_SECONDS,
  });
};

const refreshRoomTtls = async (redis, roomCode, hasMembers) => {
  const multi = redis.multi();
  multi.expire(roomMetaKey(roomCode), ROOM_TTL_SECONDS);
  if (hasMembers) {
    multi.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
  }
  await multi.exec();
};

const isMember = (members, userId) =>
  members.some((member) => member.userId === userId);

const isRoomAuthorized = (roomMeta, members, userId) =>
  roomMeta.hostUserId === userId || isMember(members, userId);

const computeAllReady = (members) =>
  members.length > 0 && members.every((member) => member.ready === true);

const emitRoomMembers = async (io, redis, roomCode) => {
  const members = await getRoomMembers(redis, roomCode);
  const allReady = computeAllReady(members);
  io.to(roomCode).emit("room-members-updated", { roomCode, members, allReady });
  return { members, allReady };
};

const deleteRoomState = async (redis, roomCode, members) => {
  for (const member of members) {
    const userSocketKey = roomUserSocketsKey(roomCode, member.userId);
    const socketIds = await redis.sMembers(userSocketKey);

    if (socketIds.length > 0) {
      const multi = redis.multi();
      for (const socketId of socketIds) {
        multi.sRem(socketRoomsKey(socketId), roomCode);
      }
      await multi.exec();
    }

    await redis.del(userSocketKey);
  }

  await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
};

export const initSocket = (io, redis) => {
  io.use(async (socket, next) => {
    try {
      const token = getCookieValue(socket.handshake.headers.cookie || "", "token");
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded._id).select("_id username role");
      if (!user) return next(new Error("Unauthorized"));

      socket.data.user = {
        id: String(user._id),
        username: user.username,
        role: user.role,
      };

      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket:connect] ${socket.id}`);

    socket.on("create-room", async (_payload, ack) => {
      try {
        if (socket.data.user?.role !== "admin") {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Only admin can create room"))
            : undefined;
        }

        let roomCode = generateRoomCode();
        while (await redis.exists(roomMetaKey(roomCode))) {
          roomCode = generateRoomCode();
        }

        const hostName = getSocketName(socket);
        const hostMember = toMember(socket, false);
        const roomMeta = {
          roomCode,
          hostUserId: socket.data.user.id,
          hostName,
          status: "lobby",
          contestStartAt: null,
          createdAt: new Date().toISOString(),
        };

        const multi = redis.multi();
        multi.set(roomMetaKey(roomCode), JSON.stringify(roomMeta), {
          EX: ROOM_TTL_SECONDS,
        });
        multi.hSet(
          roomMembersKey(roomCode),
          hostMember.userId,
          JSON.stringify(hostMember)
        );
        multi.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
        multi.sAdd(roomUserSocketsKey(roomCode, hostMember.userId), socket.id);
        multi.expire(
          roomUserSocketsKey(roomCode, hostMember.userId),
          ROOM_TTL_SECONDS
        );
        multi.sAdd(socketRoomsKey(socket.id), roomCode);
        multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
        await multi.exec();

        socket.join(roomCode);
        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName,
                hostUserId: roomMeta.hostUserId,
                status: roomMeta.status,
                contestStartAt: roomMeta.contestStartAt,
                members,
                allReady,
              })
            )
          : undefined;
      } catch (error) {
        console.error("create-room error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not create room"))
          : undefined;
      }
    });

    socket.on("join-room", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const existingMembers = await getRoomMembers(redis, roomCode);
        const userId = socket.data.user.id;
        const existingMember = existingMembers.find((m) => m.userId === userId);

        if (roomMeta.status === "running" && !existingMember) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Contest already started"))
            : undefined;
        }

        const memberToStore = existingMember
          ? {
              ...existingMember,
              username: socket.data.user.username,
            }
          : toMember(socket, false);

        const multi = redis.multi();
        multi.hSet(roomMembersKey(roomCode), userId, JSON.stringify(memberToStore));
        multi.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
        multi.sAdd(roomUserSocketsKey(roomCode, userId), socket.id);
        multi.expire(roomUserSocketsKey(roomCode, userId), ROOM_TTL_SECONDS);
        multi.sAdd(socketRoomsKey(socket.id), roomCode);
        multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
        multi.expire(roomMetaKey(roomCode), ROOM_TTL_SECONDS);
        await multi.exec();

        socket.join(roomCode);
        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName: roomMeta.hostName,
                hostUserId: roomMeta.hostUserId,
                status: roomMeta.status,
                contestStartAt: roomMeta.contestStartAt || null,
                members,
                allReady,
              })
            )
          : undefined;
      } catch (error) {
        console.error("join-room error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not join room"))
          : undefined;
      }
    });

    socket.on("get-room-members", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const members = await getRoomMembers(redis, roomCode);
        const requesterId = socket.data.user.id;
        if (!isRoomAuthorized(roomMeta, members, requesterId)) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName: roomMeta.hostName,
                hostUserId: roomMeta.hostUserId,
                status: roomMeta.status,
                contestStartAt: roomMeta.contestStartAt || null,
                members,
                allReady: computeAllReady(members),
              })
            )
          : undefined;
      } catch (error) {
        console.error("get-room-members error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not load members"))
          : undefined;
      }
    });

    socket.on("set-ready", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        if (roomMeta.status !== "lobby") {
          return typeof ack === "function"
            ? ack(fail("BAD_STATE", "Contest already started"))
            : undefined;
        }

        const userId = socket.data.user.id;
        const memberRaw = await redis.hGet(roomMembersKey(roomCode), userId);
        if (!memberRaw) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }

        const member = JSON.parse(memberRaw);
        const nextReady =
          typeof payload.ready === "boolean" ? payload.ready : !member.ready;

        const nextMember = {
          ...member,
          username: socket.data.user.username,
          ready: nextReady,
        };

        const multi = redis.multi();
        multi.hSet(roomMembersKey(roomCode), userId, JSON.stringify(nextMember));
        multi.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
        multi.expire(roomMetaKey(roomCode), ROOM_TTL_SECONDS);
        await multi.exec();

        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
        return typeof ack === "function"
          ? ack(ok({ roomCode, members, allReady }))
          : undefined;
      } catch (error) {
        console.error("set-ready error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not update ready state"))
          : undefined;
      }
    });

    socket.on("start-contest", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        if (roomMeta.hostUserId !== socket.data.user.id) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Only host can start contest"))
            : undefined;
        }

        if (roomMeta.status !== "lobby") {
          return typeof ack === "function"
            ? ack(fail("BAD_STATE", "Contest already started"))
            : undefined;
        }

        const members = await getRoomMembers(redis, roomCode);
        const allReady = computeAllReady(members);
        if (!allReady) {
          return typeof ack === "function"
            ? ack(fail("BAD_STATE", "All members must be ready"))
            : undefined;
        }

        const contestStartAt = Date.now() + CONTEST_COUNTDOWN_MS;
        const nextMeta = {
          ...roomMeta,
          status: "running",
          contestStartAt,
        };
        await setRoomMeta(redis, roomCode, nextMeta);

        io.to(roomCode).emit("contest-starting", {
          roomCode,
          contestStartAt,
        });

        return typeof ack === "function"
          ? ack(ok({ roomCode, contestStartAt, status: "running" }))
          : undefined;
      } catch (error) {
        console.error("start-contest error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not start contest"))
          : undefined;
      }
    });

    socket.on("leave-room", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const userId = socket.data.user.id;
        const userSocketKey = roomUserSocketsKey(roomCode, userId);

        await redis.sRem(userSocketKey, socket.id);
        const remainingSockets = await redis.sCard(userSocketKey);

        if (remainingSockets === 0) {
          await redis.hDel(roomMembersKey(roomCode), userId);
          await redis.del(userSocketKey);
        } else {
          await redis.expire(userSocketKey, ROOM_TTL_SECONDS);
        }

        await redis.sRem(socketRoomsKey(socket.id), roomCode);
        socket.leave(roomCode);

        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
        await refreshRoomTtls(redis, roomCode, members.length > 0);

        return typeof ack === "function"
          ? ack(ok({ roomCode, members, allReady }))
          : undefined;
      } catch (error) {
        console.error("leave-room error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not leave room"))
          : undefined;
      }
    });

    socket.on("close-room", async (payload = {}, ack) => {
      try {
        const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!roomCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        if (roomMeta.hostUserId !== socket.data.user.id) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Only host can close room"))
            : undefined;
        }

        const members = await getRoomMembers(redis, roomCode);
        io.to(roomCode).emit("room-closed", {
          roomCode,
          message: "Room closed by host",
        });
        io.in(roomCode).socketsLeave(roomCode);

        await deleteRoomState(redis, roomCode, members);

        return typeof ack === "function"
          ? ack(ok({ roomCode }))
          : undefined;
      } catch (error) {
        console.error("close-room error:", error.message);
        return typeof ack === "function"
          ? ack(fail("INTERNAL_ERROR", "Could not close room"))
          : undefined;
      }
    });

    socket.on("disconnect", async (reason) => {
      try {
        const socketName = getSocketName(socket);
        const userId = socket.data?.user?.id;
        if (!userId) {
          console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
          return;
        }

        const roomCodes = await redis.sMembers(socketRoomsKey(socket.id));

        for (const roomCode of roomCodes) {
          const userSocketKey = roomUserSocketsKey(roomCode, userId);
          await redis.sRem(userSocketKey, socket.id);

          const remainingSockets = await redis.sCard(userSocketKey);
          if (remainingSockets === 0) {
            await redis.hDel(roomMembersKey(roomCode), userId);
            await redis.del(userSocketKey);
          } else {
            await redis.expire(userSocketKey, ROOM_TTL_SECONDS);
          }

          const roomMeta = await getRoomMeta(redis, roomCode);
          if (!roomMeta) continue;

          const { members } = await emitRoomMembers(io, redis, roomCode);
          await refreshRoomTtls(redis, roomCode, members.length > 0);
        }

        await redis.del(socketRoomsKey(socket.id));
        console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
      } catch (error) {
        console.error("disconnect cleanup error:", error.message);
      }
    });
  });
};
