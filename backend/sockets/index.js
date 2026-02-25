import { randomUUID } from "crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Contest from "../models/Contest.js";
import ContestRoom from "../models/ContestRoom.js";
import Problem from "../models/Problem.js";
import {
  ALLOWED_RUN_LANGUAGES,
  MAX_RUN_CODE_BYTES,
  MAX_RUN_INPUT_BYTES,
} from "../services/judge/constants.js";
import { enqueueJudgeJob } from "../services/judge/queue.js";
import { validateCodePolicy } from "../services/judge/codePolicy.js";
import {
  finalizeContestRoomResults,
  resolveRoomStandings,
} from "../services/contest/results.js";
import { registerJudgeSocketHandlers } from "./judgeEventHandlers.js";
import { registerRoomSocketHandlers } from "./roomEventHandlers.js";

const ROOM_TTL_SECONDS = 60 * 60 * 6;
const CONTEST_COUNTDOWN_MS = 3000;
const ACTIVE_ROOM_STATUSES = ["lobby", "running"];
const ROOM_STATUS_TO_CONTEST_ACTIVE = {
  lobby: true,
  running: true,
  ended: false,
  closed: false,
};
const REJOIN_PARTICIPANT_STATES = new Set(["active", "disconnected"]);
const CACHE_MEMBER_STATES = new Set(["active"]);
const contestEndTimers = new Map();
const SOCKET_RATE_LIMITS = {
  runCode: {
    limit: 30,
    windowSeconds: 60,
  },
  submitCode: {
    limit: 12,
    windowSeconds: 60,
  },
};

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

const normalizeProblemIds = (value) => {
  if (!Array.isArray(value)) return [];
  const uniqueProblemIds = new Set();

  for (const item of value) {
    const problemId = String(item || "").trim();
    if (!problemId) continue;
    if (!mongoose.Types.ObjectId.isValid(problemId)) continue;
    uniqueProblemIds.add(problemId);
  }

  return Array.from(uniqueProblemIds);
};

const normalizeContestTitle = (value, roomCode) => {
  const rawTitle = String(value || "").trim();
  if (rawTitle) return rawTitle.slice(0, 120);
  return `Room ${roomCode} Contest`;
};

const normalizeContestDescription = (value) =>
  String(value || "")
    .trim()
    .slice(0, 2000);

const normalizeContestDuration = (value) => {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 90;
  const bounded = Math.max(5, Math.min(720, Math.floor(duration)));
  return bounded;
};

const normalizeRunLanguage = (value) => String(value || "").trim().toLowerCase();

const getUserRoomName = (userId) => `user:${userId}`;

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
const socketRateLimitKey = ({ eventName, userId, roomCode }) =>
  `ratelimit:socket:${eventName}:user:${userId}:room:${roomCode}`;

const toMember = (socket, ready = false) => ({
  userId: socket.data.user.id,
  username: socket.data.user.username,
  ready,
  score: 0,
  penalty: 0,
  solvedCount: 0,
});

const participantToMember = (participant) => ({
  userId: participant.userId,
  username: participant.username,
  ready: participant.ready === true,
  score: Number.isFinite(Number(participant.score))
    ? Number(participant.score)
    : 0,
  penalty: Number.isFinite(Number(participant.penalty))
    ? Number(participant.penalty)
    : 0,
  solvedCount: Number.isFinite(Number(participant.solvedCount))
    ? Number(participant.solvedCount)
    : 0,
});

const toMillis = (value) => {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  const ms = dateValue.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const contestActiveForRoomStatus = (status) =>
  ROOM_STATUS_TO_CONTEST_ACTIVE[status] ?? false;

const syncContestActiveState = async (contestId, roomStatus) => {
  const normalizedContestId = String(contestId || "").trim();
  if (!normalizedContestId) return;

  await Contest.updateOne(
    { _id: normalizedContestId, isActive: { $ne: contestActiveForRoomStatus(roomStatus) } },
    { $set: { isActive: contestActiveForRoomStatus(roomStatus) } }
  );
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

const consumeSocketRateLimit = async (
  redis,
  { eventName, userId, roomCode, limit, windowSeconds }
) => {
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.floor(Number(limit)))
    : 10;
  const normalizedWindowSeconds = Number.isFinite(Number(windowSeconds))
    ? Math.max(1, Math.floor(Number(windowSeconds)))
    : 60;
  const key = socketRateLimitKey({
    eventName: String(eventName || "event"),
    userId: String(userId || "unknown"),
    roomCode: normalizeRoomCode(roomCode || "global"),
  });

  try {
    const currentCount = await redis.incr(key);
    if (currentCount === 1) {
      await redis.expire(key, normalizedWindowSeconds);
    }

    const ttl = await redis.ttl(key);
    return {
      ok: currentCount <= normalizedLimit,
      count: currentCount,
      remaining: Math.max(0, normalizedLimit - currentCount),
      retryAfterSeconds: ttl > 0 ? ttl : normalizedWindowSeconds,
    };
  } catch (error) {
    console.error("socket rate limiter error:", error.message);
    return {
      ok: true,
      count: 0,
      remaining: normalizedLimit,
      retryAfterSeconds: 0,
    };
  }
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
  const roomMetaContestId = String(roomMeta.contestId || "").trim();
  if (
    roomMetaContestId &&
    String(roomDoc.contestId || "") !== roomMetaContestId
  ) {
    roomDoc.contestId = roomMetaContestId;
    changed = true;
  }

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

  const currentEndAt = toMillis(roomDoc.contestEndAt);
  const nextEndAt =
    typeof roomMeta.contestEndAt === "number" ? roomMeta.contestEndAt : null;

  if (currentEndAt !== nextEndAt) {
    roomDoc.contestEndAt =
      typeof nextEndAt === "number" ? new Date(nextEndAt) : null;
    changed = true;
  }

  return changed;
};

const ensureContestRoom = async (roomCode, roomMeta) => {
  let roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc && roomMeta) {
    const contestId = String(roomMeta.contestId || "").trim();
    if (!contestId) return null;

    roomDoc = new ContestRoom({
      roomCode,
      contestId,
      hostUserId: roomMeta.hostUserId,
      hostName: roomMeta.hostName,
      status: roomMeta.status,
      contestStartAt:
        typeof roomMeta.contestStartAt === "number"
          ? new Date(roomMeta.contestStartAt)
          : null,
      contestEndAt:
        typeof roomMeta.contestEndAt === "number"
          ? new Date(roomMeta.contestEndAt)
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
      score: 0,
      penalty: 0,
      solvedCount: 0,
      solvedProblemIds: [],
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

const setContestRoomStatus = async ({
  roomCode,
  status,
  contestStartAt,
  contestEndAt,
}) => {
  const roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc) return null;

  roomDoc.status = status;
  if (typeof contestStartAt === "number") {
    roomDoc.contestStartAt = new Date(contestStartAt);
  } else if (contestStartAt === null) {
    roomDoc.contestStartAt = null;
  }

  if (typeof contestEndAt === "number") {
    roomDoc.contestEndAt = new Date(contestEndAt);
  } else if (contestEndAt === null) {
    roomDoc.contestEndAt = null;
  }

  if (status === "closed") {
    const now = new Date();
    // Preserve timeline history when closing an already started contest.
    if (roomDoc.contestStartAt && !roomDoc.contestEndAt) {
      roomDoc.contestEndAt = now;
    }

    for (const participant of roomDoc.participants) {
      participant.state = "left";
      participant.ready = false;
      participant.lastSeenAt = now;
    }
  }

  await roomDoc.save();
  await syncContestActiveState(roomDoc.contestId, status);
  return roomDoc;
};

const buildRoomMetaFromDoc = (roomDoc) => ({
  roomCode: roomDoc.roomCode,
  contestId: roomDoc.contestId ? String(roomDoc.contestId) : null,
  hostUserId: roomDoc.hostUserId,
  hostName: roomDoc.hostName,
  status: roomDoc.status,
  contestStartAt: toMillis(roomDoc.contestStartAt),
  contestEndAt: toMillis(roomDoc.contestEndAt),
  createdAt: roomDoc.createdAt
    ? new Date(roomDoc.createdAt).toISOString()
    : new Date().toISOString(),
});

const syncRoomCacheFromDb = async (redis, roomCode) => {
  const roomDoc = await ContestRoom.findOne({ roomCode }).lean();

  if (!roomDoc) {
    await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
    return null;
  }

  await syncContestActiveState(roomDoc.contestId, roomDoc.status);

  if (!ACTIVE_ROOM_STATUSES.includes(roomDoc.status)) {
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
    $or: [
      {
        participants: {
          $elemMatch: {
            userId,
            state: { $in: Array.from(REJOIN_PARTICIPANT_STATES) },
          },
        },
      },
      {
        hostUserId: userId,
        participants: {
          $not: {
            $elemMatch: {
              userId,
              state: "left",
            },
          },
        },
      },
    ],
  };

  if (excludeRoomCode) {
    query.roomCode = { $ne: excludeRoomCode };
  }

  return ContestRoom.findOne(query).select("roomCode status").lean();
};

const clearContestEndTimer = (roomCode) => {
  const timer = contestEndTimers.get(roomCode);
  if (!timer) return;
  clearTimeout(timer);
  contestEndTimers.delete(roomCode);
};

const endContestRoom = async ({
  io,
  redis,
  roomCode,
  message = "Contest time completed",
}) => {
  clearContestEndTimer(roomCode);

  const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
  if (!roomMeta || roomMeta.status !== "running") return false;

  const endedRoom = await setContestRoomStatus({
    roomCode,
    status: "ended",
    contestEndAt: Date.now(),
  });
  const finalizedRoom = await finalizeContestRoomResults({
    roomCode,
    roomDoc: endedRoom,
  });
  const finalStandings = resolveRoomStandings(finalizedRoom || endedRoom || {});

  const members = await getRoomMembers(redis, roomCode);
  io.to(roomCode).emit("contest-ended", {
    roomCode,
    message,
    status: "ended",
    resultsReady: true,
    resultsPath: `/results?room=${roomCode}`,
    finalStandings,
  });
  io.in(roomCode).socketsLeave(roomCode);

  if (members.length > 0) {
    await deleteRoomState(redis, roomCode, members);
  } else {
    await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
  }

  await syncRoomCacheFromDb(redis, roomCode);
  return true;
};

const scheduleContestEnd = ({ io, redis, roomCode, contestEndAt }) => {
  if (typeof contestEndAt !== "number") return;

  clearContestEndTimer(roomCode);

  const delay = contestEndAt - Date.now();
  if (delay <= 0) {
    void endContestRoom({ io, redis, roomCode });
    return;
  }

  const timer = setTimeout(() => {
    void endContestRoom({ io, redis, roomCode });
  }, delay);
  contestEndTimers.set(roomCode, timer);
};

const restoreRunningContestTimers = async (io, redis) => {
  try {
    const runningRooms = await ContestRoom.find({
      status: "running",
      contestEndAt: { $ne: null },
    })
      .select("roomCode contestId contestEndAt")
      .lean();

    for (const room of runningRooms) {
      await syncContestActiveState(room.contestId, "running");
      const contestEndAt = toMillis(room.contestEndAt);
      if (!contestEndAt) continue;
      scheduleContestEnd({
        io,
        redis,
        roomCode: room.roomCode,
        contestEndAt,
      });
    }
  } catch (error) {
    console.error("restore contest timers error:", error.message);
  }
};

const reconcileContestActivityStates = async () => {
  try {
    const rooms = await ContestRoom.find({ contestId: { $ne: null } })
      .select("contestId status")
      .lean();

    for (const room of rooms) {
      await syncContestActiveState(room.contestId, room.status);
    }
  } catch (error) {
    console.error("reconcile contest activity states error:", error.message);
  }
};

export const initSocket = (io, redis) => {
  void (async () => {
    await reconcileContestActivityStates();
    await restoreRunningContestTimers(io, redis);
  })();

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
    socket.join(getUserRoomName(socket.data.user.id));

    registerRoomSocketHandlers({
      io,
      redis,
      socket,
      ok,
      fail,
      Contest,
      ContestRoom,
      Problem,
      finalizeContestRoomResults,
      ROOM_TTL_SECONDS,
      CONTEST_COUNTDOWN_MS,
      normalizeRoomCode,
      normalizeProblemIds,
      normalizeContestTitle,
      normalizeContestDescription,
      normalizeContestDuration,
      getSocketName,
      generateRoomCode,
      toMember,
      findUserActiveRoom,
      getRoomMetaOrHydrate,
      endContestRoom,
      getPersistedParticipant,
      upsertContestParticipant,
      syncRoomCacheFromDb,
      roomUserSocketsKey,
      socketRoomsKey,
      emitRoomMembers,
      getRoomMeta,
      deleteRoomState,
      getRoomMembers,
      roomMetaKey,
      roomMembersKey,
      computeAllReady,
      isRoomAuthorized,
      setContestRoomStatus,
      scheduleContestEnd,
      setContestParticipantState,
      clearContestEndTimer,
      refreshRoomTtls,
    });

    registerJudgeSocketHandlers({
      io,
      redis,
      socket,
      ok,
      fail,
      normalizeRoomCode,
      normalizeRunLanguage,
      getRoomMetaOrHydrate,
      endContestRoom,
      getRoomMembers,
      isRoomAuthorized,
      getPersistedParticipant,
      ALLOWED_RUN_LANGUAGES,
      MAX_RUN_CODE_BYTES,
      MAX_RUN_INPUT_BYTES,
      enqueueJudgeJob,
      validateCodePolicy,
      Contest,
      ContestRoom,
      Problem,
      mongoose,
      randomUUID,
      consumeSocketRateLimit,
      SOCKET_RATE_LIMITS,
    });
  });
};
