import Contest from "../../models/Contest.js";
import ContestRoom from "../../models/ContestRoom.js";
import {
  finalizeContestRoomResults,
} from "../../services/contest/results.js";

export const ACTIVE_ROOM_STATUSES = ["lobby", "running"];
export const ACTIVE_PARTICIPANT_STATES = ["active", "disconnected"];

export const normalizeRoomCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

export const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

export const parseDuration = (value) => {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 90;
  return Math.max(5, Math.min(720, Math.floor(duration)));
};

export const toMillis = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

export const isActiveRoomStatus = (status) =>
  ACTIVE_ROOM_STATUSES.includes(status);

export const normalizeBoolean = (value) => value === true;

export const toStandingsMember = (standing = {}) => ({
  rank: Number.isFinite(Number(standing.rank)) ? Number(standing.rank) : null,
  userId: String(standing.userId || ""),
  username: String(standing.username || ""),
  state: String(standing.state || "active"),
  ready: normalizeBoolean(standing.ready),
  score: Number.isFinite(Number(standing.score)) ? Number(standing.score) : 0,
  penalty: Number.isFinite(Number(standing.penalty))
    ? Number(standing.penalty)
    : 0,
  solvedCount: Number.isFinite(Number(standing.solvedCount))
    ? Number(standing.solvedCount)
    : 0,
  solvedProblemIds: Array.isArray(standing.solvedProblemIds)
    ? standing.solvedProblemIds.map((item) => String(item))
    : [],
  joinedAt: Number.isFinite(Number(standing.joinedAt))
    ? Number(standing.joinedAt)
    : toMillis(standing.joinedAt),
  lastSeenAt: Number.isFinite(Number(standing.lastSeenAt))
    ? Number(standing.lastSeenAt)
    : toMillis(standing.lastSeenAt),
});

export const acceptedVerdictExpression = {
  $and: [
    { $eq: ["$status", "done"] },
    { $eq: ["$verdict", "Accepted"] },
    { $gt: ["$testcasesTotal", 0] },
    { $eq: ["$testcasesPassed", "$testcasesTotal"] },
  ],
};

export const getAuthorizedRoomForUser = async ({
  roomCode,
  userId,
  select = "_id roomCode contestId status hostUserId hostName participants",
}) => {
  return ContestRoom.findOne({
    roomCode,
    $or: [{ hostUserId: userId }, { participants: { $elemMatch: { userId } } }],
  })
    .select(select)
    .lean();
};

export const syncContestActiveStateByRoom = async ({
  contestId,
  roomStatus,
  currentContestIsActive,
}) => {
  if (!contestId) return isActiveRoomStatus(roomStatus);

  const expectedIsActive = isActiveRoomStatus(roomStatus);
  if (
    typeof currentContestIsActive === "boolean" &&
    currentContestIsActive === expectedIsActive
  ) {
    return expectedIsActive;
  }

  await Contest.updateOne(
    { _id: contestId, isActive: { $ne: expectedIsActive } },
    { $set: { isActive: expectedIsActive } }
  );
  return expectedIsActive;
};

export const reconcileExpiredRunningRoom = async (room) => {
  if (!room || room.status !== "running") return room;

  const contestEndAtMs = toMillis(room.contestEndAt);
  if (typeof contestEndAtMs !== "number") {
    return room;
  }

  if (contestEndAtMs > Date.now()) {
    return room;
  }

  const finalizedEndAt = new Date();
  await ContestRoom.updateOne(
    { _id: room._id, status: "running" },
    {
      $set: {
        status: "ended",
        contestEndAt: finalizedEndAt,
      },
    }
  );

  await finalizeContestRoomResults({
    roomCode: room.roomCode,
  });

  return {
    ...room,
    status: "ended",
    contestEndAt: finalizedEndAt,
  };
};
