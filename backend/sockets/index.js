import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const rooms = new Map();

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

const emitRoomMembers = (io, roomCode, members) => {
  io.to(roomCode).emit("room-members-updated", { roomCode, members });
};

const getCookieValue = (cookieHeader = "", key) => {
  const part = cookieHeader
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${key}=`));
  if (!part) return "";
  return decodeURIComponent(part.slice(key.length + 1));
};

const isMember = (room, userId) =>
  room.members.some((m) => m.userId === userId);

const toMember = (socket) => ({
  userId: socket.data.user.id,
  username: socket.data.user.username,
  socketId: socket.id,
});

const isRoomAuthorized = (room, userId) =>
  room.hostUserId === userId || isMember(room, userId);

export const initSocket = (io) => {
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

    socket.on("create-room", (_payload, ack) => {
      if (socket.data.user?.role !== "admin") {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Only admin can create room"))
          : undefined;
      }

      const roomCode = generateRoomCode();
      const hostName = getSocketName(socket);
      const hostMember = toMember(socket);
      const members = [hostMember];

      rooms.set(roomCode, {
        roomCode,
        hostUserId: socket.data.user.id,
        hostName,
        members,
        createdAt: new Date().toISOString(),
      });

      socket.join(roomCode);
      emitRoomMembers(io, roomCode, members);

      return typeof ack === "function"
        ? ack(ok({ roomCode, hostName, members }))
        : undefined;
    });

    socket.on("join-room", (payload = {}, ack) => {
      const normalizedCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!normalizedCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const room = rooms.get(normalizedCode);
      if (!room) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      const userId = socket.data.user.id;
      const memberIndex = room.members.findIndex((m) => m.userId === userId);

      if (memberIndex === -1) {
        room.members.push(toMember(socket));
      } else {
        room.members[memberIndex] = {
          ...room.members[memberIndex],
          username: socket.data.user.username,
          socketId: socket.id,
        };
      }

      rooms.set(normalizedCode, room);
      socket.join(normalizedCode);
      emitRoomMembers(io, normalizedCode, room.members);

      return typeof ack === "function"
        ? ack(ok({ roomCode: normalizedCode, members: room.members }))
        : undefined;
    });

    socket.on("get-room-members", (payload = {}, ack) => {
      const normalizedCode = normalizeRoomCode(payload.roomCode);
      if (!normalizedCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const room = rooms.get(normalizedCode);
      if (!room) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      const requesterId = socket.data.user.id;
      if (!isRoomAuthorized(room, requesterId)) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Not in room"))
          : undefined;
      }

      return typeof ack === "function"
        ? ack(ok({ roomCode: normalizedCode, members: room.members }))
        : undefined;
    });

    socket.on("disconnect", (reason) => {
      const socketName = getSocketName(socket);
      const userId = socket.data?.user?.id;

      for (const [roomCode, room] of rooms.entries()) {
        const nextMembers = userId
          ? room.members.filter((member) => member.userId !== userId)
          : room.members.filter((member) => member.socketId !== socket.id);

        if (nextMembers.length === 0) {
          rooms.delete(roomCode);
          continue;
        }

        if (nextMembers.length === room.members.length) {
          continue;
        }

        rooms.set(roomCode, { ...room, members: nextMembers });
        emitRoomMembers(io, roomCode, nextMembers);
      }

      console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
    });
  });
};
