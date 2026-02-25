import ContestRoom from "../../models/ContestRoom.js";

export const FINALIZED_ROOM_STATUSES = new Set(["ended", "closed"]);

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toStringArray = (value) =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];

const toMillis = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const sortStandings = (entries) =>
  [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    return String(a.username || "").localeCompare(String(b.username || ""));
  });

const normalizeParticipantRow = (participant = {}, index = 0) => ({
  rank: index + 1,
  userId: String(participant.userId || ""),
  username: String(participant.username || ""),
  ready: participant.ready === true,
  state: String(participant.state || "active"),
  score: toFiniteNumber(participant.score),
  penalty: toFiniteNumber(participant.penalty),
  solvedCount: toFiniteNumber(participant.solvedCount),
  solvedProblemIds: toStringArray(participant.solvedProblemIds),
  joinedAt: toMillis(participant.joinedAt),
  lastSeenAt: toMillis(participant.lastSeenAt),
});

export const buildStandingsFromParticipants = (participants = []) => {
  const sorted = sortStandings(
    (Array.isArray(participants) ? participants : []).map((participant) =>
      normalizeParticipantRow(participant, 0)
    )
  );

  return sorted.map((participant, index) => ({
    ...participant,
    rank: index + 1,
  }));
};

export const normalizeStoredStandings = (standings = []) => {
  const normalized = (Array.isArray(standings) ? standings : []).map(
    (standing, index) => ({
      ...normalizeParticipantRow(standing, index),
      rank: toFiniteNumber(standing.rank, index + 1),
    })
  );

  const hasValidRanks = normalized.every(
    (standing) => standing.rank >= 1 && Number.isInteger(standing.rank)
  );

  if (!hasValidRanks || normalized.length <= 1) {
    return normalized.map((standing, index) => ({
      ...standing,
      rank: index + 1,
    }));
  }

  return [...normalized].sort((a, b) => a.rank - b.rank);
};

export const resolveRoomStandings = (roomLike = {}) => {
  const storedStandings = normalizeStoredStandings(roomLike.finalStandings);
  if (storedStandings.length > 0) return storedStandings;
  return buildStandingsFromParticipants(roomLike.participants);
};

export const finalizeContestRoomResults = async ({
  roomCode,
  roomDoc = null,
  force = false,
} = {}) => {
  const normalizedRoomCode = String(roomCode || "").trim().toUpperCase();
  const room = roomDoc || (normalizedRoomCode ? await ContestRoom.findOne({ roomCode: normalizedRoomCode }) : null);
  if (!room) return null;

  const roomStatus = String(room.status || "");
  const contestStarted = Number.isFinite(toMillis(room.contestStartAt));
  const shouldFinalizeForStatus =
    roomStatus === "ended" || (roomStatus === "closed" && contestStarted);

  if (!force && !shouldFinalizeForStatus) {
    return room;
  }

  const hasStoredStandings =
    Array.isArray(room.finalStandings) &&
    room.finalStandings.length > 0 &&
    room.finalizedAt instanceof Date;
  if (hasStoredStandings && !force) {
    return room;
  }

  room.finalStandings = buildStandingsFromParticipants(room.participants).map(
    (standing) => ({
      rank: standing.rank,
      userId: standing.userId,
      username: standing.username,
      ready: standing.ready,
      state: standing.state,
      score: standing.score,
      penalty: standing.penalty,
      solvedCount: standing.solvedCount,
      solvedProblemIds: standing.solvedProblemIds,
      joinedAt: standing.joinedAt ? new Date(standing.joinedAt) : null,
      lastSeenAt: standing.lastSeenAt ? new Date(standing.lastSeenAt) : null,
    })
  );

  if (FINALIZED_ROOM_STATUSES.has(roomStatus) && !room.contestEndAt) {
    room.contestEndAt = new Date();
  }

  room.finalizedAt = new Date();
  await room.save();
  return room;
};
