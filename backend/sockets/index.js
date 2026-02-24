import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import ContestRoom from "../models/ContestRoom.js";

const ROOM_TTL_SECONDS = 60 * 60 * 6;
const CONTEST_COUNTDOWN_MS = 3000;
const ACTIVE_ROOM_STATUSES = ["lobby", "running"];
const REJOIN_PARTICIPANT_STATES = new Set(["active", "disconnected"]);
const CACHE_MEMBER_STATES = new Set(["active"]);

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

const participantToMember = (participant) => ({
  userId: participant.userId,
  username: participant.username,
  ready: participant.ready === true,
});

const toMillis = (value) => {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  const ms = dateValue.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const getRoomMeta = async (redis, roomCode) => {
  const raw = await redis.get(roomMetaKey(roomCode));
  return raw ? JSON.parse(raw) : null;
};

const getRoomMembers = async (redis, roomCode) => {
  const map = await redis.hGetAll(roomMembersKey(roomCode));
  return Object.values(map).map((value) => JSON.parse(value));
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

const syncRoomDocMeta = (roomDoc, roomMeta) => {
  if (!roomMeta) return false;

  let changed = false;
  if (roomDoc.hostUserId !== roomMeta.hostUserId) {
    roomDoc.hostUserId = roomMeta.hostUserId;
    changed = true;
  }

  if (roomDoc.hostName !== roomMeta.hostName) {
    roomDoc.hostName = roomMeta.hostName;
    changed = true;
  }

  if (roomDoc.status !== roomMeta.status) {
    roomDoc.status = roomMeta.status;
    changed = true;
  }

  const currentStartAt = toMillis(roomDoc.contestStartAt);
  const nextStartAt =
    typeof roomMeta.contestStartAt === "number" ? roomMeta.contestStartAt : null;

  if (currentStartAt !== nextStartAt) {
    roomDoc.contestStartAt =
      typeof nextStartAt === "number" ? new Date(nextStartAt) : null;
    changed = true;
  }

  return changed;
};

const ensureContestRoom = async (roomCode, roomMeta) => {
  let roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc && roomMeta) {
    roomDoc = new ContestRoom({
      roomCode,
      hostUserId: roomMeta.hostUserId,
      hostName: roomMeta.hostName,
      status: roomMeta.status,
      contestStartAt:
        typeof roomMeta.contestStartAt === "number"
          ? new Date(roomMeta.contestStartAt)
          : null,
      participants: [],
    });
  }

  return roomDoc;
};

const upsertContestParticipant = async ({
  roomCode,
  roomMeta,
  userId,
  username,
  ready,
  state = "active",
}) => {
  const roomDoc = await ensureContestRoom(roomCode, roomMeta);
  if (!roomDoc) return null;

  const now = new Date();
  let changed = syncRoomDocMeta(roomDoc, roomMeta);
  const participant = roomDoc.participants.find((item) => item.userId === userId);

  if (!participant) {
    roomDoc.participants.push({
      userId,
      username,
      ready: ready === true,
      state,
      joinedAt: now,
      lastSeenAt: now,
    });
    changed = true;
  } else {
    if (participant.username !== username) {
      participant.username = username;
      changed = true;
    }

    if (typeof ready === "boolean" && participant.ready !== ready) {
      participant.ready = ready;
      changed = true;
    }

    if (participant.state !== state) {
      participant.state = state;
      changed = true;
    }

    participant.lastSeenAt = now;
    changed = true;
  }

  if (changed) {
    await roomDoc.save();
  }

  return roomDoc;
};

const setContestParticipantState = async ({ roomCode, userId, state, ready }) => {
  const roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc) return null;

  const participant = roomDoc.participants.find((item) => item.userId === userId);
  if (!participant) return roomDoc;

  let changed = false;
  if (participant.state !== state) {
    participant.state = state;
    changed = true;
  }

  if (typeof ready === "boolean" && participant.ready !== ready) {
    participant.ready = ready;
    changed = true;
  }

  participant.lastSeenAt = new Date();
  changed = true;

  if (changed) {
    await roomDoc.save();
  }

  return roomDoc;
};

const setContestRoomStatus = async ({ roomCode, status, contestStartAt }) => {
  const roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc) return null;

  roomDoc.status = status;
  roomDoc.contestStartAt =
    typeof contestStartAt === "number" ? new Date(contestStartAt) : null;

  if (status === "closed") {
    const now = new Date();
    for (const participant of roomDoc.participants) {
      participant.state = "left";
      participant.ready = false;
      participant.lastSeenAt = now;
    }
  }

  await roomDoc.save();
  return roomDoc;
};

const buildRoomMetaFromDoc = (roomDoc) => ({
  roomCode: roomDoc.roomCode,
  hostUserId: roomDoc.hostUserId,
  hostName: roomDoc.hostName,
  status: roomDoc.status,
  contestStartAt: toMillis(roomDoc.contestStartAt),
  createdAt: roomDoc.createdAt
    ? new Date(roomDoc.createdAt).toISOString()
    : new Date().toISOString(),
});

const syncRoomCacheFromDb = async (redis, roomCode) => {
  const roomDoc = await ContestRoom.findOne({ roomCode }).lean();

  if (!roomDoc || !ACTIVE_ROOM_STATUSES.includes(roomDoc.status)) {
    await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
    return null;
  }

  const roomMeta = buildRoomMetaFromDoc(roomDoc);
  const members = Array.isArray(roomDoc.participants)
    ? roomDoc.participants
        .filter((participant) =>
          CACHE_MEMBER_STATES.has(participant.state || "active")
        )
        .map(participantToMember)
    : [];

  const multi = redis.multi();
  multi.set(roomMetaKey(roomCode), JSON.stringify(roomMeta), {
    EX: ROOM_TTL_SECONDS,
  });
  multi.del(roomMembersKey(roomCode));

  if (members.length > 0) {
    for (const member of members) {
      multi.hSet(roomMembersKey(roomCode), member.userId, JSON.stringify(member));
    }
    multi.expire(roomMembersKey(roomCode), ROOM_TTL_SECONDS);
  } else {
    multi.del(roomMembersKey(roomCode));
  }

  await multi.exec();

  return { roomMeta, members };
};

const getRoomMetaOrHydrate = async (redis, roomCode) => {
  const cachedMeta = await getRoomMeta(redis, roomCode);
  if (cachedMeta) return cachedMeta;

  const hydrated = await syncRoomCacheFromDb(redis, roomCode);
  return hydrated?.roomMeta || null;
};

const getPersistedParticipant = (roomDoc, userId) =>
  roomDoc?.participants?.find(
    (participant) =>
      participant.userId === userId &&
      REJOIN_PARTICIPANT_STATES.has(participant.state || "active")
  );

const findUserActiveRoom = async (userId, excludeRoomCode = null) => {
  const query = {
    status: { $in: ACTIVE_ROOM_STATUSES },
    participants: {
      $elemMatch: {
        userId,
        state: { $in: Array.from(REJOIN_PARTICIPANT_STATES) },
      },
    },
  };

  if (excludeRoomCode) {
    query.roomCode = { $ne: excludeRoomCode };
  }

  return ContestRoom.findOne(query).select("roomCode status").lean();
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
      let roomCode = "";
      try {
        if (socket.data.user?.role !== "admin") {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Only admin can create room"))
            : undefined;
        }

        const userId = socket.data.user.id;
        const alreadyActiveRoom = await findUserActiveRoom(userId);
        if (alreadyActiveRoom) {
          const activeLabel =
            alreadyActiveRoom.status === "running" ? "contest" : "lobby";
          return typeof ack === "function"
            ? ack(
                fail(
                  "BAD_STATE",
                  `You are already in an active ${activeLabel} (${alreadyActiveRoom.roomCode}). Leave it first.`
                )
              )
            : undefined;
        }

        roomCode = generateRoomCode();
        while (
          (await redis.exists(roomMetaKey(roomCode))) ||
          (await ContestRoom.exists({ roomCode }))
        ) {
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

        await ContestRoom.create({
          roomCode,
          hostUserId: roomMeta.hostUserId,
          hostName: roomMeta.hostName,
          status: roomMeta.status,
          contestStartAt: null,
          participants: [
            {
              userId: hostMember.userId,
              username: hostMember.username,
              ready: hostMember.ready,
              state: "active",
              joinedAt: new Date(),
              lastSeenAt: new Date(),
            },
          ],
        });

        try {
          const synced = await syncRoomCacheFromDb(redis, roomCode);
          if (!synced?.roomMeta) {
            throw new Error("Could not sync room cache");
          }

          const multi = redis.multi();
          multi.sAdd(roomUserSocketsKey(roomCode, hostMember.userId), socket.id);
          multi.expire(
            roomUserSocketsKey(roomCode, hostMember.userId),
            ROOM_TTL_SECONDS
          );
          multi.sAdd(socketRoomsKey(socket.id), roomCode);
          multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
          await multi.exec();
        } catch (redisError) {
          await ContestRoom.deleteOne({ roomCode });
          throw redisError;
        }

        socket.join(roomCode);
        const freshMeta = await getRoomMeta(redis, roomCode);
        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName: freshMeta?.hostName || hostName,
                hostUserId: freshMeta?.hostUserId || roomMeta.hostUserId,
                status: freshMeta?.status || roomMeta.status,
                contestStartAt: freshMeta?.contestStartAt || roomMeta.contestStartAt,
                members,
                allReady,
              })
            )
          : undefined;
      } catch (error) {
        console.error("create-room error:", error.message);
        if (roomCode) {
          const members = await getRoomMembers(redis, roomCode);
          if (members.length > 0) {
            await deleteRoomState(redis, roomCode, members);
          } else {
            await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
          }
        }

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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const userId = socket.data.user.id;
        const alreadyActiveRoom = await findUserActiveRoom(userId, roomCode);
        if (alreadyActiveRoom) {
          const activeLabel =
            alreadyActiveRoom.status === "running" ? "contest" : "lobby";
          return typeof ack === "function"
            ? ack(
                fail(
                  "BAD_STATE",
                  `You are already in an active ${activeLabel} (${alreadyActiveRoom.roomCode}). Leave it first.`
                )
              )
            : undefined;
        }

        const roomDoc = await ContestRoom.findOne({ roomCode })
          .select("participants")
          .lean();
        const persistedParticipant = getPersistedParticipant(roomDoc, userId);

        if (roomMeta.status === "running" && !persistedParticipant) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Contest already started"))
            : undefined;
        }

        const readyFromDb = persistedParticipant
          ? persistedParticipant.ready === true
          : false;

        await upsertContestParticipant({
          roomCode,
          roomMeta,
          userId,
          username: socket.data.user.username,
          ready: readyFromDb,
          state: "active",
        });

        const synced = await syncRoomCacheFromDb(redis, roomCode);
        if (!synced?.roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const multi = redis.multi();
        multi.sAdd(roomUserSocketsKey(roomCode, userId), socket.id);
        multi.expire(roomUserSocketsKey(roomCode, userId), ROOM_TTL_SECONDS);
        multi.sAdd(socketRoomsKey(socket.id), roomCode);
        multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
        await multi.exec();

        socket.join(roomCode);
        const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
        const syncedMeta = synced.roomMeta;

        return typeof ack === "function"
          ? ack(
              ok({
                roomCode,
                hostName: syncedMeta.hostName,
                hostUserId: syncedMeta.hostUserId,
                status: syncedMeta.status,
                contestStartAt: syncedMeta.contestStartAt || null,
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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const members = await getRoomMembers(redis, roomCode);
        const requesterId = socket.data.user.id;

        if (!isRoomAuthorized(roomMeta, members, requesterId)) {
          const roomDoc = await ContestRoom.findOne({ roomCode })
            .select("hostUserId participants")
            .lean();

          const persistedParticipant = getPersistedParticipant(roomDoc, requesterId);
          const isHost = roomDoc?.hostUserId === requesterId;

          if (!persistedParticipant && !isHost) {
            return typeof ack === "function"
              ? ack(fail("FORBIDDEN", "Not in room"))
              : undefined;
          }
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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
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

        await upsertContestParticipant({
          roomCode,
          roomMeta,
          userId,
          username: socket.data.user.username,
          ready: nextReady,
          state: "active",
        });

        await syncRoomCacheFromDb(redis, roomCode);
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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
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
        await setContestRoomStatus({
          roomCode,
          status: "running",
          contestStartAt,
        });
        await syncRoomCacheFromDb(redis, roomCode);

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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
        if (!roomMeta) {
          return typeof ack === "function"
            ? ack(fail("NOT_FOUND", "Room not found"))
            : undefined;
        }

        const userId = socket.data.user.id;
        await setContestParticipantState({
          roomCode,
          userId,
          state: "left",
          ready: false,
        });

        const userSocketKey = roomUserSocketsKey(roomCode, userId);
        const socketIds = await redis.sMembers(userSocketKey);

        const multi = redis.multi();
        for (const socketId of socketIds) {
          multi.sRem(socketRoomsKey(socketId), roomCode);
          io.in(socketId).socketsLeave(roomCode);
        }
        multi.del(userSocketKey);
        multi.sRem(socketRoomsKey(socket.id), roomCode);
        await multi.exec();

        socket.leave(roomCode);
        await syncRoomCacheFromDb(redis, roomCode);

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

        const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
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

        await setContestRoomStatus({
          roomCode,
          status: "closed",
          contestStartAt: null,
        });

        const members = await getRoomMembers(redis, roomCode);
        io.to(roomCode).emit("room-closed", {
          roomCode,
          message: "Room closed by host",
        });
        io.in(roomCode).socketsLeave(roomCode);

        await deleteRoomState(redis, roomCode, members);
        await syncRoomCacheFromDb(redis, roomCode);

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
            await setContestParticipantState({
              roomCode,
              userId,
              state: "disconnected",
            });

            await redis.del(userSocketKey);
          } else {
            await redis.expire(userSocketKey, ROOM_TTL_SECONDS);
          }

          const synced = await syncRoomCacheFromDb(redis, roomCode);
          if (!synced?.roomMeta) continue;

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
