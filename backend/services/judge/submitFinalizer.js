import { SUBMIT_PENALTY_POINTS } from "./constants.js";
import ContestRoom from "../../models/ContestRoom.js";
import Submission from "../../models/Submission.js";

const penaltyVerdicts = new Set([
  "Wrong Answer",
  "Time Limit Exceeded",
  "Runtime Error",
  "Compilation Error",
  "Memory Limit Exceeded",
]);
const scoreableRoomStatuses = new Set(["running"]);

const toLeaderboardMember = (participant) => ({
  userId: participant.userId,
  username: participant.username,
  ready: participant.ready === true,
  score: Number.isFinite(Number(participant.score)) ? Number(participant.score) : 0,
  penalty: Number.isFinite(Number(participant.penalty)) ? Number(participant.penalty) : 0,
  solvedCount: Number.isFinite(Number(participant.solvedCount))
    ? Number(participant.solvedCount)
    : 0,
});

const sortLeaderboardMembers = (members) =>
  [...members].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    return String(a.username || "").localeCompare(String(b.username || ""));
  });

const duplicateKeyError = (error) => Number(error?.code) === 11000;

const submitIdempotencyFilter = ({
  submissionType,
  requestId,
  roomCode,
  userId,
  problemId,
}) => {
  if (submissionType !== "submit") return null;

  const normalizedRequestId = String(requestId || "").trim();
  const normalizedRoomCode = String(roomCode || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedProblemId = String(problemId || "").trim();

  if (!normalizedRequestId || !normalizedRoomCode || !normalizedUserId || !normalizedProblemId) {
    return null;
  }

  return {
    submissionType: "submit",
    requestId: normalizedRequestId,
    roomCode: normalizedRoomCode,
    userId: normalizedUserId,
    problemId: normalizedProblemId,
  };
};

const buildSubmissionDoc = ({
  status,
  requestId,
  submissionType,
  userId,
  username,
  problemId,
  contestId,
  roomCode,
  code,
  language,
  customInput,
  verdict,
  executionTime,
  memoryUsed,
  stdout,
  stderr,
  testcasesPassed,
  testcasesTotal,
  scoreDelta,
  penaltyDelta,
}) => ({
  status,
  requestId,
  submissionType,
  userId,
  username,
  problemId,
  contestId,
  roomCode,
  code,
  language,
  customInput,
  verdict,
  executionTime,
  memoryUsed,
  stdout,
  stderr,
  testcasesPassed,
  testcasesTotal,
  scoreDelta,
  penaltyDelta,
  judgedAt: new Date(),
});

const emitLeaderboardSnapshot = async ({ io, roomCode }) => {
  const roomDoc = await ContestRoom.findOne({ roomCode }).lean();
  if (!roomDoc) return;

  const leaderboardMembers = sortLeaderboardMembers(
    (Array.isArray(roomDoc.participants) ? roomDoc.participants : [])
      .filter((item) => ["active", "disconnected"].includes(item.state || "active"))
      .map(toLeaderboardMember)
  );

  io.to(roomCode).emit("leaderboard-updated", {
    roomCode,
    members: leaderboardMembers,
    updatedAt: Date.now(),
  });
};

const emitSubmissionFromStoredRecord = async ({ io, storedSubmission }) => {
  if (!storedSubmission) return;

  const submission =
    typeof storedSubmission.toObject === "function"
      ? storedSubmission.toObject()
      : storedSubmission;

  const payloadData = {
    requestId: String(submission.requestId || ""),
    roomCode: String(submission.roomCode || ""),
    contestId: String(submission.contestId || ""),
    problemId: String(submission.problemId || ""),
    userId: String(submission.userId || ""),
    username: String(submission.username || ""),
    language: String(submission.language || ""),
    code: String(submission.code || ""),
    customInput: String(submission.customInput || ""),
    verdict: String(submission.verdict || "Pending"),
    stdout: String(submission.stdout || ""),
    stderr: String(submission.stderr || ""),
    runtimeMs: Number.isFinite(Number(submission.executionTime))
      ? Number(submission.executionTime)
      : null,
    memoryKb: Number.isFinite(Number(submission.memoryUsed))
      ? Number(submission.memoryUsed)
      : null,
    testcasesPassed: Number.isFinite(Number(submission.testcasesPassed))
      ? Number(submission.testcasesPassed)
      : 0,
    testcasesTotal: Number.isFinite(Number(submission.testcasesTotal))
      ? Number(submission.testcasesTotal)
      : 0,
    scoreDelta: Number.isFinite(Number(submission.scoreDelta))
      ? Number(submission.scoreDelta)
      : 0,
    penaltyDelta: Number.isFinite(Number(submission.penaltyDelta))
      ? Number(submission.penaltyDelta)
      : 0,
    solvedNow: Number.isFinite(Number(submission.scoreDelta))
      ? Number(submission.scoreDelta) > 0
      : false,
    completedAt: submission.judgedAt ? new Date(submission.judgedAt).getTime() : Date.now(),
  };

  if (submission.status === "done") {
    io.to(`user:${submission.userId}`).emit("submission-result", {
      ok: true,
      data: payloadData,
      duplicate: true,
    });
    await emitLeaderboardSnapshot({ io, roomCode: payloadData.roomCode });
    return;
  }

  if (submission.status === "judging" || submission.status === "queued") {
    io.to(`user:${submission.userId}`).emit("submission-result", {
      ok: false,
      code: "DUPLICATE_REQUEST",
      message: "Submission already in progress.",
      data: payloadData,
      duplicate: true,
    });
    return;
  }

  io.to(`user:${submission.userId}`).emit("submission-result", {
    ok: false,
    code: "DUPLICATE_REQUEST",
    message: "Submission already processed.",
    data: payloadData,
    duplicate: true,
  });
};

export const recordSubmission = async (submissionInput) => {
  const doc = buildSubmissionDoc(submissionInput);
  const dedupeFilter = submitIdempotencyFilter(submissionInput);

  try {
    return await Submission.create(doc);
  } catch (error) {
    if (!duplicateKeyError(error) || !dedupeFilter) throw error;

    const existing = await Submission.findOne(dedupeFilter);
    if (!existing) throw error;

    if (existing.status === "judging" && submissionInput.status !== "judging") {
      existing.set(doc);
      await existing.save();
    }

    return existing;
  }
};

const reserveSubmitRequest = async (payload) => {
  const reservationInput = {
    status: "judging",
    requestId: payload.requestId,
    submissionType: "submit",
    userId: payload.userId,
    username: payload.username,
    problemId: payload.problemId,
    contestId: payload.contestId,
    roomCode: payload.roomCode,
    code: payload.code,
    language: payload.language,
    customInput: payload.customInput || "",
    verdict: "Pending",
    executionTime: null,
    memoryUsed: null,
    stdout: "",
    stderr: "",
    testcasesPassed: 0,
    testcasesTotal: Number.isFinite(Number(payload.testcasesTotal))
      ? Number(payload.testcasesTotal)
      : 0,
    scoreDelta: 0,
    penaltyDelta: 0,
  };

  const dedupeFilter = submitIdempotencyFilter(reservationInput);

  if (!dedupeFilter) {
    const created = await recordSubmission(reservationInput);
    return { reserved: true, submission: created };
  }

  const existing = await Submission.findOne(dedupeFilter);
  if (existing) {
    return { reserved: false, submission: existing };
  }

  try {
    const created = await Submission.create(buildSubmissionDoc(reservationInput));
    return { reserved: true, submission: created };
  } catch (error) {
    if (!duplicateKeyError(error)) throw error;
    const duplicateDoc = await Submission.findOne(dedupeFilter);
    return { reserved: false, submission: duplicateDoc };
  }
};

const updateReservedSubmission = async (submissionId, fields) => {
  return Submission.findByIdAndUpdate(
    submissionId,
    {
      $set: {
        ...fields,
        judgedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );
};

export const finalizeSubmitJob = async ({ io, payload }) => {
  const roomCode = String(payload.roomCode || "");
  const userId = String(payload.userId || "");
  const problemId = String(payload.problemId || "");
  const testcasesTotal = Number.isFinite(Number(payload.testcasesTotal))
    ? Math.max(0, Math.floor(Number(payload.testcasesTotal)))
    : 0;
  const testcasesPassed = Number.isFinite(Number(payload.testcasesPassed))
    ? Math.max(0, Math.floor(Number(payload.testcasesPassed)))
    : 0;

  const reservation = await reserveSubmitRequest({
    ...payload,
    testcasesTotal,
  });

  if (!reservation.reserved) {
    await emitSubmissionFromStoredRecord({ io, storedSubmission: reservation.submission });
    return;
  }

  const reservedSubmissionId = reservation.submission._id;

  const roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc) {
    await updateReservedSubmission(reservedSubmissionId, {
      status: "failed",
      verdict: payload.verdict,
      executionTime: payload.runtimeMs,
      memoryUsed: payload.memoryKb,
      stdout: payload.stdout,
      stderr: payload.stderr || "Room not found",
      testcasesPassed: payload.testcasesPassed || 0,
      testcasesTotal: payload.testcasesTotal || 0,
      scoreDelta: 0,
      penaltyDelta: 0,
    });
    io.to(`user:${userId}`).emit("submission-result", {
      ok: false,
      code: "NOT_FOUND",
      message: "Room not found",
      data: payload,
    });
    return;
  }

  const participant = roomDoc.participants.find((item) => item.userId === userId);
  if (!participant) {
    await updateReservedSubmission(reservedSubmissionId, {
      status: "failed",
      verdict: payload.verdict,
      executionTime: payload.runtimeMs,
      memoryUsed: payload.memoryKb,
      stdout: payload.stdout,
      stderr: payload.stderr || "Participant not found",
      testcasesPassed: payload.testcasesPassed || 0,
      testcasesTotal: payload.testcasesTotal || 0,
      scoreDelta: 0,
      penaltyDelta: 0,
    });
    io.to(`user:${userId}`).emit("submission-result", {
      ok: false,
      code: "FORBIDDEN",
      message: "Participant not found in room",
      data: payload,
    });
    return;
  }

  if (!scoreableRoomStatuses.has(String(roomDoc.status || ""))) {
    await updateReservedSubmission(reservedSubmissionId, {
      status: "failed",
      verdict: payload.verdict,
      executionTime: payload.runtimeMs,
      memoryUsed: payload.memoryKb,
      stdout: payload.stdout,
      stderr: `Contest is ${roomDoc.status}. Submission not counted.`,
      testcasesPassed: payload.testcasesPassed || 0,
      testcasesTotal,
      scoreDelta: 0,
      penaltyDelta: 0,
    });
    io.to(`user:${userId}`).emit("submission-result", {
      ok: false,
      code: "BAD_STATE",
      message: `Contest is ${roomDoc.status}. Submission not counted.`,
      data: payload,
    });
    return;
  }

  if (testcasesTotal <= 0) {
    await updateReservedSubmission(reservedSubmissionId, {
      status: "failed",
      verdict: payload.verdict,
      executionTime: payload.runtimeMs,
      memoryUsed: payload.memoryKb,
      stdout: payload.stdout,
      stderr: payload.stderr || "Judge returned invalid testcase metadata",
      testcasesPassed,
      testcasesTotal,
      scoreDelta: 0,
      penaltyDelta: 0,
    });
    io.to(`user:${userId}`).emit("submission-result", {
      ok: false,
      code: "BAD_STATE",
      message: "Submission judge metadata invalid. Please retry.",
      data: {
        ...payload,
        testcasesPassed,
        testcasesTotal,
      },
    });
    return;
  }

  participant.score = Number.isFinite(Number(participant.score))
    ? Number(participant.score)
    : 0;
  participant.penalty = Number.isFinite(Number(participant.penalty))
    ? Number(participant.penalty)
    : 0;
  participant.solvedCount = Number.isFinite(Number(participant.solvedCount))
    ? Number(participant.solvedCount)
    : 0;
  participant.solvedProblemIds = Array.isArray(participant.solvedProblemIds)
    ? participant.solvedProblemIds.map((item) => String(item))
    : [];

  const solvedBefore = participant.solvedProblemIds.includes(problemId);

  let scoreDelta = 0;
  let penaltyDelta = 0;
  let solvedNow = false;

  const strictAccepted =
    payload.verdict === "Accepted" && testcasesPassed === testcasesTotal;
  const effectiveVerdict = strictAccepted
    ? "Accepted"
    : payload.verdict === "Accepted"
      ? "Wrong Answer"
      : String(payload.verdict || "Runtime Error");

  if (strictAccepted) {
    if (!solvedBefore) {
      const baseCredit = Number.isFinite(Number(payload.problemCredit))
        ? Number(payload.problemCredit)
        : 100;
      scoreDelta = Math.max(0, baseCredit);
      participant.score += scoreDelta;
      participant.solvedCount += 1;
      participant.solvedProblemIds.push(problemId);
      solvedNow = true;
    }
  } else if (!solvedBefore && penaltyVerdicts.has(effectiveVerdict)) {
    penaltyDelta = SUBMIT_PENALTY_POINTS;
    participant.penalty += penaltyDelta;
  }

  participant.lastSeenAt = new Date();
  await roomDoc.save();

  await updateReservedSubmission(reservedSubmissionId, {
    status: "done",
    verdict: effectiveVerdict,
    executionTime: payload.runtimeMs,
    memoryUsed: payload.memoryKb,
    stdout: payload.stdout,
    stderr: payload.stderr,
    testcasesPassed,
    testcasesTotal,
    scoreDelta,
    penaltyDelta,
  });

  const leaderboardMembers = sortLeaderboardMembers(
    roomDoc.participants
      .filter((item) => ["active", "disconnected"].includes(item.state || "active"))
      .map(toLeaderboardMember)
  );

  io.to(`user:${userId}`).emit("submission-result", {
    ok: true,
    data: {
      ...payload,
      verdict: effectiveVerdict,
      testcasesPassed,
      testcasesTotal,
      scoreDelta,
      penaltyDelta,
      solvedNow,
    },
  });
  io.to(roomCode).emit("leaderboard-updated", {
    roomCode,
    members: leaderboardMembers,
    updatedAt: Date.now(),
  });
};
