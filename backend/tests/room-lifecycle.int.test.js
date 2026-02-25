import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Contest from "../models/Contest.js";
import ContestRoom from "../models/ContestRoom.js";
import Problem from "../models/Problem.js";
import Submission from "../models/Submission.js";
import { finalizeContestRoomResults, resolveRoomStandings } from "../services/contest/results.js";
import { finalizeSubmitJob } from "../services/judge/submitFinalizer.js";

const makeIoSpy = () => {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        },
      };
    },
  };
};

const submitPayload = ({
  roomCode,
  contestId,
  problemId,
  userId,
  username,
  verdict,
  testcasesPassed,
  testcasesTotal,
  problemCredit = 100,
}) => ({
  requestId: new mongoose.Types.ObjectId().toString(),
  roomCode,
  contestId,
  problemId,
  userId,
  username,
  language: "cpp",
  code: "int main(){return 0;}",
  customInput: "",
  problemCredit,
  verdict,
  stdout: "",
  stderr: "",
  runtimeMs: 50,
  memoryKb: 128,
  testcasesPassed,
  testcasesTotal,
  timedOut: false,
  completedAt: Date.now(),
});

let mongoServer;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    dbName: "devarena_room_lifecycle_test",
  });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await Promise.all([
    Submission.deleteMany({}),
    ContestRoom.deleteMany({}),
    Contest.deleteMany({}),
    Problem.deleteMany({}),
  ]);
});

test("lifecycle transitions from lobby to finalized standings with scored submissions", async () => {
  const io = makeIoSpy();
  const roomCode = "FLOW9001";
  const hostUserId = "host-1";

  const problem = await Problem.create({
    title: "A + B",
    slug: "a-plus-b",
    description: "Add two numbers",
    difficulty: "Easy",
    hiddenTestcases: [
      { input: "1 2", output: "3" },
      { input: "10 5", output: "15" },
    ],
    createdBy: hostUserId,
    isActive: true,
  });

  const contest = await Contest.create({
    title: "Room Contest",
    description: "Lifecycle test contest",
    problems: [problem._id],
    duration: 60,
    createdBy: hostUserId,
    isActive: true,
  });

  const room = await ContestRoom.create({
    roomCode,
    contestId: contest._id,
    hostUserId,
    hostName: "admin",
    status: "lobby",
    participants: [
      {
        userId: hostUserId,
        username: "admin",
        state: "active",
        ready: true,
        score: 0,
        penalty: 0,
        solvedCount: 0,
        solvedProblemIds: [],
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        userId: "u1",
        username: "alice",
        state: "active",
        ready: true,
        score: 0,
        penalty: 0,
        solvedCount: 0,
        solvedProblemIds: [],
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        userId: "u2",
        username: "bob",
        state: "active",
        ready: true,
        score: 0,
        penalty: 0,
        solvedCount: 0,
        solvedProblemIds: [],
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
    ],
  });

  const contestStartAt = Date.now();
  const contestEndAt = contestStartAt + 60 * 60 * 1000;

  room.status = "running";
  room.contestStartAt = new Date(contestStartAt);
  room.contestEndAt = new Date(contestEndAt);
  await room.save();

  await finalizeSubmitJob({
    io,
    payload: submitPayload({
      roomCode,
      contestId: String(contest._id),
      problemId: String(problem._id),
      userId: "u1",
      username: "alice",
      verdict: "Wrong Answer",
      testcasesPassed: 0,
      testcasesTotal: 2,
    }),
  });

  await finalizeSubmitJob({
    io,
    payload: submitPayload({
      roomCode,
      contestId: String(contest._id),
      problemId: String(problem._id),
      userId: "u1",
      username: "alice",
      verdict: "Accepted",
      testcasesPassed: 2,
      testcasesTotal: 2,
      problemCredit: 100,
    }),
  });

  await finalizeSubmitJob({
    io,
    payload: submitPayload({
      roomCode,
      contestId: String(contest._id),
      problemId: String(problem._id),
      userId: "u2",
      username: "bob",
      verdict: "Wrong Answer",
      testcasesPassed: 0,
      testcasesTotal: 2,
    }),
  });

  const runningRoom = await ContestRoom.findOne({ roomCode }).lean();
  assert.ok(runningRoom);

  const aliceDuringRun = runningRoom.participants.find((item) => item.userId === "u1");
  const bobDuringRun = runningRoom.participants.find((item) => item.userId === "u2");

  assert.equal(aliceDuringRun.score, 100);
  assert.equal(aliceDuringRun.penalty, 10);
  assert.equal(aliceDuringRun.solvedCount, 1);
  assert.deepEqual(aliceDuringRun.solvedProblemIds, [String(problem._id)]);

  assert.equal(bobDuringRun.score, 0);
  assert.equal(bobDuringRun.penalty, 10);
  assert.equal(bobDuringRun.solvedCount, 0);

  await ContestRoom.updateOne(
    { roomCode },
    {
      $set: {
        status: "ended",
        contestEndAt: new Date(),
      },
    }
  );

  const finalized = await finalizeContestRoomResults({ roomCode });
  assert.ok(finalized);
  assert.equal(finalized.status, "ended");
  assert.ok(Array.isArray(finalized.finalStandings));
  assert.ok(finalized.finalStandings.length >= 3);
  assert.ok(finalized.finalizedAt);

  const standings = resolveRoomStandings(finalized);
  assert.equal(standings[0].userId, "u1");
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[0].score, 100);

  const userSubmissionRecords = await Submission.find({
    roomCode,
    submissionType: "submit",
  }).lean();
  assert.equal(userSubmissionRecords.length, 3);

  const submissionResults = io.events.filter(
    (event) => event.room.startsWith("user:") && event.event === "submission-result"
  );
  assert.equal(submissionResults.length, 3);
});
