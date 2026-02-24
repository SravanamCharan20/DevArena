import { randomUUID } from "crypto";

const rooms = new Map();
const guestNameFromSocketId = (socketId) => `guest-${socketId.slice(0, 6)}`;
const getSocketName = (socket) =>
  socket.data?.username || guestNameFromSocketId(socket.id);

export const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log(`[socket:connect] ${socket.id}`);

    socket.on("register-user", (payload = {}, ack) => {
      const rawName = typeof payload.username === "string" ? payload.username.trim() : "";
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
      const roomCode = randomUUID();
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
      }

      console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
    });
  });
};
