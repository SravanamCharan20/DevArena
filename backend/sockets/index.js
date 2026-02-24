import { randomUUID } from "crypto";

const rooms = new Map();
const guestNameFromSocketId = (socketId) => `guest-${socketId.slice(0, 6)}`;
const getSocketName = (socket) =>
  socket.data?.username || guestNameFromSocketId(socket.id);
const generateRoomCode = () => randomUUID().split("-")[0].toUpperCase();
const normalizeRoomCode = (value) => String(value || "").trim().toUpperCase();
const emitRoomMembers = (io, roomCode, members) => {
  io.to(roomCode).emit("room-members-updated", { roomCode, members });
};

export const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log(`[socket:connect] ${socket.id}`);

    socket.on("register-user", (payload = {}, ack) => {
      const rawName =
        typeof payload.username === "string" ? payload.username.trim() : "";
      socket.data.username = rawName || guestNameFromSocketId(socket.id);

      if (typeof ack === "function") {
        ack({
          ok: true,
          socketId: socket.id,
          username: socket.data.username,
        });
      }
    });

    socket.on("create-room", (_payload, ack) => {
      const roomCode = generateRoomCode();
      const hostName = getSocketName(socket);
      const members = [{ socketId: socket.id, username: hostName }];

      rooms.set(roomCode, {
        roomCode,
        hostSocketId: socket.id,
        hostName,
        members,
        createdAt: new Date().toISOString(),
      });

      socket.join(roomCode);

      if (typeof ack === "function") {
        ack({ ok: true, roomCode, hostName, members });
      }

      emitRoomMembers(io, roomCode, members);
    });

    socket.on("join-room", (payload = {}, ack) => {
      const normalizedCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!normalizedCode) {
        return typeof ack === "function"
          ? ack({ ok: false, message: "Room code is required" })
          : undefined;
      }


      const room = rooms.get(normalizedCode);
      if (!room) {
        return typeof ack === "function"
          ? ack({ ok: false, message: "Room not found" })
          : undefined;
      }

      const alreadyMember = room.members.some((m) => m.socketId === socket.id);
      if (!alreadyMember) {
        room.members.push({
          socketId: socket.id,
          username: getSocketName(socket),
        });
        rooms.set(normalizedCode, room);
      }

      socket.join(normalizedCode);

      if (typeof ack === "function") {
        ack({
          ok: true,
          roomCode: normalizedCode,
          members: room.members,
        });
      }

      emitRoomMembers(io, normalizedCode, room.members);
    });

    socket.on("get-room-members", (payload = {}, ack) => {
      const normalizedCode = normalizeRoomCode(payload.roomCode);
      if (!normalizedCode) {
        return typeof ack === "function"
          ? ack({ ok: false, message: "Room code is required" })
          : undefined;
      }

      const room = rooms.get(normalizedCode);
      if (!room) {
        return typeof ack === "function"
          ? ack({ ok: false, message: "Room not found" })
          : undefined;
      }

      if (typeof ack === "function") {
        ack({ ok: true, roomCode: normalizedCode, members: room.members });
      }
    });

    socket.on("disconnect", (reason) => {
      const socketName = getSocketName(socket);

      for (const [roomCode, room] of rooms.entries()) {
        const nextMembers = room.members.filter(
          (member) => member.socketId !== socket.id
        );

        if (nextMembers.length === 0) {
          rooms.delete(roomCode);
          continue;
        }

        rooms.set(roomCode, { ...room, members: nextMembers });
        emitRoomMembers(io, roomCode, nextMembers);
      }

      console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
    });
  });
};
