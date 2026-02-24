import { randomUUID } from "crypto";

const rooms = new Map();

export const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log(socket.id);

    socket.on("create-room", (payload, ack) => {
      const roomCode = randomUUID();

      rooms.set(roomCode, {
        hostSocketId: socket.id,
        createdBy: payload?.createdBy || "unknown",
        members: [socket.id],
      });

      socket.join(roomCode);

      ack({ ok: true, roomCode, members: rooms.members });
    });
  });
};
