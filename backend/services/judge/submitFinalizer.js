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

export const recordSubmission = async ({
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
}) => {
  await Submission.create({
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

  const roomDoc = await ContestRoom.findOne({ roomCode });
  if (!roomDoc) {
    await recordSubmission({
      status: "failed",
      requestId: payload.requestId,
      submissionType: "submit",
      userId,
      username: payload.username,
      problemId,
      contestId: payload.contestId,
      roomCode,
      code: payload.code,
      language: payload.language,
      customInput: payload.customInput,
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
    await recordSubmission({
      status: "failed",
      requestId: payload.requestId,
      submissionType: "submit",
      userId,
      username: payload.username,
      problemId,
      contestId: payload.contestId,
      roomCode,
      code: payload.code,
      language: payload.language,
      customInput: payload.customInput,
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
    await recordSubmission({
      status: "failed",
      requestId: payload.requestId,
      submissionType: "submit",
      userId,
      username: payload.username,
      problemId,
      contestId: payload.contestId,
      roomCode,
      code: payload.code,
      language: payload.language,
      customInput: payload.customInput,
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
    await recordSubmission({
      status: "failed",
      requestId: payload.requestId,
      submissionType: "submit",
      userId,
      username: payload.username,
      problemId,
      contestId: payload.contestId,
      roomCode,
      code: payload.code,
      language: payload.language,
      customInput: payload.customInput,
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

  await recordSubmission({
    status: "done",
    requestId: payload.requestId,
    submissionType: "submit",
    userId,
    username: payload.username,
    problemId,
    contestId: payload.contestId,
    roomCode,
    code: payload.code,
    language: payload.language,
    customInput: payload.customInput,
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
