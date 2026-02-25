import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ContestRoom from "../models/ContestRoom.js";
import Submission from "../models/Submission.js";
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

const basePayload = (overrides = {}) => ({
  requestId: new mongoose.Types.ObjectId().toString(),
  roomCode: "ROOM1234",
  contestId: new mongoose.Types.ObjectId().toString(),
  problemId: new mongoose.Types.ObjectId().toString(),
  userId: "u1",
  username: "alice",
  language: "cpp",
  code: "int main(){return 0;}",
  customInput: "",
  problemCredit: 100,
  verdict: "Wrong Answer",
  stdout: "",
  stderr: "",
  runtimeMs: 123,
  memoryKb: null,
  testcasesPassed: 0,
  testcasesTotal: 4,
  timedOut: false,
  completedAt: Date.now(),
  ...overrides,
});

const createRoom = async ({ roomCode = "ROOM1234", status = "running" } = {}) => {
  const contestId = new mongoose.Types.ObjectId();
  await ContestRoom.create({
    roomCode,
    contestId,
    hostUserId: "host-1",
    hostName: "host",
    status,
    participants: [
      {
        userId: "u1",
        username: "alice",
        state: "active",
        ready: false,
        score: 0,
        penalty: 0,
        solvedCount: 0,
        solvedProblemIds: [],
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
    ],
  });

  return contestId.toString();
};

let mongoServer;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    dbName: "devarena_submit_scoring_test",
  });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await Submission.deleteMany({});
  await ContestRoom.deleteMany({});
});

test("Accepted with partial testcase pass is normalized to Wrong Answer and adds penalty", async () => {
  const contestId = await createRoom();
  const io = makeIoSpy();
  const payload = basePayload({
    contestId,
    verdict: "Accepted",
    testcasesPassed: 0,
    testcasesTotal: 4,
  });

  await finalizeSubmitJob({ io, payload });

  const room = await ContestRoom.findOne({ roomCode: payload.roomCode }).lean();
  assert.ok(room);
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 0);
  assert.equal(participant.penalty, 10);
  assert.equal(participant.solvedCount, 0);

  const submission = await Submission.findOne({ requestId: payload.requestId }).lean();
  assert.ok(submission);
  assert.equal(submission.status, "done");
  assert.equal(submission.verdict, "Wrong Answer");
  assert.equal(submission.scoreDelta, 0);
  assert.equal(submission.penaltyDelta, 10);

  const resultEvent = io.events.find(
    (entry) => entry.room === "user:u1" && entry.event === "submission-result"
  );
  assert.ok(resultEvent);
  assert.equal(resultEvent.payload.ok, true);
  assert.equal(resultEvent.payload.data.verdict, "Wrong Answer");
  assert.equal(resultEvent.payload.data.penaltyDelta, 10);
});

test("Accepted full pass gives score once and marks solved", async () => {
  const contestId = await createRoom();
  const io = makeIoSpy();
  const payload = basePayload({
    contestId,
    verdict: "Accepted",
    testcasesPassed: 4,
    testcasesTotal: 4,
    problemCredit: 120,
  });

  await finalizeSubmitJob({ io, payload });

  const room = await ContestRoom.findOne({ roomCode: payload.roomCode }).lean();
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 120);
  assert.equal(participant.penalty, 0);
  assert.equal(participant.solvedCount, 1);
  assert.equal(participant.solvedProblemIds.length, 1);

  const submission = await Submission.findOne({ requestId: payload.requestId }).lean();
  assert.equal(submission.status, "done");
  assert.equal(submission.verdict, "Accepted");
  assert.equal(submission.scoreDelta, 120);
  assert.equal(submission.penaltyDelta, 0);
});

test("Submitting accepted again for same problem does not add extra score or penalty", async () => {
  const contestId = await createRoom();
  const io = makeIoSpy();
  const problemId = new mongoose.Types.ObjectId().toString();

  const firstPayload = basePayload({
    contestId,
    problemId,
    verdict: "Accepted",
    testcasesPassed: 3,
    testcasesTotal: 3,
    problemCredit: 100,
  });
  await finalizeSubmitJob({ io, payload: firstPayload });

  const secondPayload = basePayload({
    contestId,
    problemId,
    verdict: "Accepted",
    testcasesPassed: 3,
    testcasesTotal: 3,
    problemCredit: 100,
  });
  await finalizeSubmitJob({ io, payload: secondPayload });

  const room = await ContestRoom.findOne({ roomCode: firstPayload.roomCode }).lean();
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 100);
  assert.equal(participant.penalty, 0);
  assert.equal(participant.solvedCount, 1);

  const secondSubmission = await Submission.findOne({
    requestId: secondPayload.requestId,
  }).lean();
  assert.equal(secondSubmission.status, "done");
  assert.equal(secondSubmission.scoreDelta, 0);
  assert.equal(secondSubmission.penaltyDelta, 0);
});

test("Submit after contest end is rejected and does not modify score/penalty", async () => {
  const contestId = await createRoom({ status: "ended" });
  const io = makeIoSpy();
  const payload = basePayload({
    contestId,
    verdict: "Accepted",
    testcasesPassed: 4,
    testcasesTotal: 4,
  });

  await finalizeSubmitJob({ io, payload });

  const room = await ContestRoom.findOne({ roomCode: payload.roomCode }).lean();
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 0);
  assert.equal(participant.penalty, 0);

  const submission = await Submission.findOne({ requestId: payload.requestId }).lean();
  assert.equal(submission.status, "failed");
  assert.equal(submission.scoreDelta, 0);
  assert.equal(submission.penaltyDelta, 0);

  const resultEvent = io.events.find(
    (entry) => entry.room === "user:u1" && entry.event === "submission-result"
  );
  assert.equal(resultEvent.payload.ok, false);
  assert.equal(resultEvent.payload.code, "BAD_STATE");
});

test("Invalid judge metadata (testcasesTotal <= 0) is rejected with no scoring", async () => {
  const contestId = await createRoom();
  const io = makeIoSpy();
  const payload = basePayload({
    contestId,
    verdict: "Accepted",
    testcasesPassed: 0,
    testcasesTotal: 0,
  });

  await finalizeSubmitJob({ io, payload });

  const room = await ContestRoom.findOne({ roomCode: payload.roomCode }).lean();
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 0);
  assert.equal(participant.penalty, 0);

  const submission = await Submission.findOne({ requestId: payload.requestId }).lean();
  assert.equal(submission.status, "failed");
  assert.equal(submission.scoreDelta, 0);
  assert.equal(submission.penaltyDelta, 0);

  const resultEvent = io.events.find(
    (entry) => entry.room === "user:u1" && entry.event === "submission-result"
  );
  assert.equal(resultEvent.payload.ok, false);
  assert.equal(resultEvent.payload.code, "BAD_STATE");
});

test("Duplicate same requestId is idempotent and does not apply penalty twice", async () => {
  const contestId = await createRoom();
  const io = makeIoSpy();
  const duplicateRequestId = new mongoose.Types.ObjectId().toString();
  const payload = basePayload({
    contestId,
    requestId: duplicateRequestId,
    verdict: "Wrong Answer",
    testcasesPassed: 0,
    testcasesTotal: 4,
  });

  await finalizeSubmitJob({ io, payload });
  await finalizeSubmitJob({ io, payload });

  const room = await ContestRoom.findOne({ roomCode: payload.roomCode }).lean();
  const participant = room.participants.find((item) => item.userId === "u1");
  assert.equal(participant.score, 0);
  assert.equal(participant.penalty, 10);

  const submissions = await Submission.find({
    requestId: duplicateRequestId,
    submissionType: "submit",
  }).lean();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].penaltyDelta, 10);
  assert.equal(submissions[0].verdict, "Wrong Answer");
});
