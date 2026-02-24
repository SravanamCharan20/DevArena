import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const ROOM_TTL_SECONDS = 60 * 60 * 6;

// response shapes
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

const toMember = (socket) => ({
  userId: socket.data.user.id,
  username: socket.data.user.username,
});

const getRoomMeta = async (redis, roomCode) => {
  const raw = await redis.get(roomMetaKey(roomCode));
  return raw ? JSON.parse(raw) : null;
};

const getRoomMembers = async (redis, roomCode) => {
  const map = await redis.hGetAll(roomMembersKey(roomCode));
  return Object.values(map).map((value) => JSON.parse(value));
};

const isMember = (members, userId) =>
  members.some((member) => member.userId === userId);

const isRoomAuthorized = (roomMeta, members, userId) =>
  roomMeta.hostUserId === userId || isMember(members, userId);

const emitRoomMembers = async (io, redis, roomCode) => {
  const members = await getRoomMembers(redis, roomCode);
  io.to(roomCode).emit("room-members-updated", { roomCode, members });
  return members;
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
        const hostMember = toMember(socket);

        const multi = redis.multi();
        multi.set(
          roomMetaKey(roomCode),
          JSON.stringify({
            roomCode,
            hostUserId: socket.data.user.id,
            hostName,
            createdAt: new Date().toISOString(),
          }),
          {
            EX: ROOM_TTL_SECONDS,
          }
        );
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
        const members = await emitRoomMembers(io, redis, roomCode);

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName,
                hostUserId: socket.data.user.id,
                members,
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
        const normalizedCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!normalizedCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, normalizedCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const member = toMember(socket);

        const multi = redis.multi();
        multi.hSet(
          roomMembersKey(normalizedCode),
          member.userId,
          JSON.stringify(member)
        );
        multi.expire(roomMembersKey(normalizedCode), ROOM_TTL_SECONDS);
        multi.sAdd(roomUserSocketsKey(normalizedCode, member.userId), socket.id);
        multi.expire(
          roomUserSocketsKey(normalizedCode, member.userId),
          ROOM_TTL_SECONDS
        );
        multi.sAdd(socketRoomsKey(socket.id), normalizedCode);
        multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
        multi.expire(roomMetaKey(normalizedCode), ROOM_TTL_SECONDS);
        await multi.exec();

        socket.join(normalizedCode);
        const members = await emitRoomMembers(io, redis, normalizedCode);

        const roomMetaAfterJoin = await getRoomMeta(redis, normalizedCode);
        return typeof ack === "function"
          ? ack(
              ok({
                roomCode: normalizedCode,
                hostName: roomMetaAfterJoin?.hostName || "",
                hostUserId: roomMetaAfterJoin?.hostUserId || "",
                members,
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
        const normalizedCode = normalizeRoomCode(payload.roomCode);
        if (!normalizedCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, normalizedCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const members = await getRoomMembers(redis, normalizedCode);
        const requesterId = socket.data.user.id;
        if (!isRoomAuthorized(roomMeta, members, requesterId)) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode: normalizedCode,
                hostName: roomMeta.hostName,
                hostUserId: roomMeta.hostUserId,
                members,
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

    socket.on("leave-room", async (payload = {}, ack) => {
      try {
        const normalizedCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!normalizedCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, normalizedCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const userId = socket.data.user.id;
        const userSocketKey = roomUserSocketsKey(normalizedCode, userId);

        await redis.sRem(userSocketKey, socket.id);
        const remainingSockets = await redis.sCard(userSocketKey);

        if (remainingSockets === 0) {
          await redis.hDel(roomMembersKey(normalizedCode), userId);
          await redis.del(userSocketKey);
        } else {
          await redis.expire(userSocketKey, ROOM_TTL_SECONDS);
        }

        await redis.sRem(socketRoomsKey(socket.id), normalizedCode);
        socket.leave(normalizedCode);

        const members = await getRoomMembers(redis, normalizedCode);
        await redis.expire(roomMetaKey(normalizedCode), ROOM_TTL_SECONDS);
        await redis.expire(roomMembersKey(normalizedCode), ROOM_TTL_SECONDS);
        io.to(normalizedCode).emit("room-members-updated", {
          roomCode: normalizedCode,
          members,
        });

        return typeof ack === "function"
          ? ack(ok({ roomCode: normalizedCode, members }))
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
        const normalizedCode = normalizeRoomCode(payload.roomCode || payload.roomId);
        if (!normalizedCode) {
          return typeof ack === "function"
            ? ack(fail("BAD_REQUEST", "Room code is required"))
            : undefined;
        }

        const roomMeta = await getRoomMeta(redis, normalizedCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const requesterId = socket.data.user.id;
        if (roomMeta.hostUserId !== requesterId) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Only host can close room"))
            : undefined;
        }

        const members = await getRoomMembers(redis, normalizedCode);
        io.to(normalizedCode).emit("room-closed", {
          roomCode: normalizedCode,
          message: "Room closed by host",
        });
        io.in(normalizedCode).socketsLeave(normalizedCode);

        await deleteRoomState(redis, normalizedCode, members);

        return typeof ack === "function"
          ? ack(ok({ roomCode: normalizedCode }))
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

          const members = await getRoomMembers(redis, roomCode);
          await redis.expire(roomMetaKey(roomCode), ROOM_TTL_SECONDS);
          if (members.length > 0) {
            await redis.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
          }
          io.to(roomCode).emit("room-members-updated", { roomCode, members });
        }

        await redis.del(socketRoomsKey(socket.id));
        console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
      } catch (error) {
        console.error("disconnect cleanup error:", error.message);
      }
    });
  });
};
