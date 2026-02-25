import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { RUN_CODE_JOB_NAME, RUN_CODE_QUEUE_NAME } from "./constants.js";
import { evaluateSubmissionAgainstTestcases } from "./evaluator.js";
import { finalizeSubmitJob, recordSubmission } from "./submitFinalizer.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const buildConnection = () =>
  new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

const queueConnection = buildConnection();
const queueEventsConnection = buildConnection();

queueConnection.on("error", (error) => {
  console.error("run queue redis connection error:", error.message);
});

queueEventsConnection.on("error", (error) => {
  console.error("run queue events redis connection error:", error.message);
});

export const runCodeQueue = new Queue(RUN_CODE_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 300,
    removeOnFail: 500,
  },
});

export const runCodeQueueEvents = new QueueEvents(RUN_CODE_QUEUE_NAME, {
  connection: queueEventsConnection,
});

let runQueueHandlersRegistered = false;

const buildRunResultPayloadFromJob = (job, overrides = {}) => {
  const jobData = job?.data || {};
  const returnValue = job?.returnvalue || {};
  const inferredTypeFromName = job?.name === "submit-code" ? "submit" : "run";
  const fallbackTestcasesTotal = Array.isArray(jobData?.judgeTestcases)
    ? jobData.judgeTestcases.length
    : 0;
  return {
    type: String(overrides.type || returnValue.type || jobData.type || inferredTypeFromName),
    requestId: String(overrides.requestId || returnValue.requestId || jobData.requestId || ""),
    roomCode: String(overrides.roomCode || returnValue.roomCode || jobData.roomCode || ""),
    contestId: String(
      overrides.contestId || returnValue.contestId || jobData.contestId || ""
    ),
    problemId: String(
      overrides.problemId || returnValue.problemId || jobData.problemId || ""
    ),
    userId: String(overrides.userId || returnValue.userId || jobData.userId || ""),
    username: String(overrides.username || returnValue.username || jobData.username || ""),
    language: String(overrides.language || returnValue.language || jobData.language || ""),
    code: String(overrides.code || returnValue.code || jobData.code || ""),
    customInput: String(
      overrides.customInput || returnValue.customInput || jobData.customInput || ""
    ),
    problemCredit: Number.isFinite(
      Number(overrides.problemCredit ?? returnValue.problemCredit ?? jobData.problemCredit)
    )
      ? Number(overrides.problemCredit ?? returnValue.problemCredit ?? jobData.problemCredit)
      : 100,
    verdict: String(overrides.verdict || returnValue.verdict || "Runtime Error"),
    stdout: String(overrides.stdout || returnValue.stdout || ""),
    stderr: String(overrides.stderr || returnValue.stderr || ""),
    runtimeMs: Number.isFinite(Number(overrides.runtimeMs ?? returnValue.runtimeMs))
      ? Number(overrides.runtimeMs ?? returnValue.runtimeMs)
      : null,
    memoryKb: Number.isFinite(Number(overrides.memoryKb ?? returnValue.memoryKb))
      ? Number(overrides.memoryKb ?? returnValue.memoryKb)
      : null,
    testcasesPassed: Number.isFinite(
      Number(overrides.testcasesPassed ?? returnValue.testcasesPassed)
    )
      ? Number(overrides.testcasesPassed ?? returnValue.testcasesPassed)
      : 0,
    testcasesTotal: Number.isFinite(
      Number(overrides.testcasesTotal ?? returnValue.testcasesTotal ?? fallbackTestcasesTotal)
    )
      ? Number(overrides.testcasesTotal ?? returnValue.testcasesTotal ?? fallbackTestcasesTotal)
      : 0,
    timedOut: Boolean(overrides.timedOut ?? returnValue.timedOut),
    completedAt:
      Number.isFinite(Number(overrides.completedAt ?? returnValue.completedAt))
        ? Number(overrides.completedAt ?? returnValue.completedAt)
        : Date.now(),
  };
};

const emitRunResultToUser = (io, userId, payload) => {
  if (!userId) return;
  io.to(`user:${userId}`).emit("run-result", { ok: true, data: payload });
};

const inferJobType = (job) => {
  const hasJudgeTestcases =
    Array.isArray(job?.data?.judgeTestcases) && job.data.judgeTestcases.length > 0;
  if (job?.name === "submit-code" || hasJudgeTestcases) return "submit";
  return String(job?.data?.type || "run");
};

const shouldRejudgeSubmitPayload = (job, payload) => {
  const hasJudgeTestcases =
    Array.isArray(job?.data?.judgeTestcases) && job.data.judgeTestcases.length > 0;
  if (!hasJudgeTestcases) return false;

  const verdict = String(payload?.verdict || "");
  const total = Number.isFinite(Number(payload?.testcasesTotal))
    ? Number(payload.testcasesTotal)
    : 0;
  const passed = Number.isFinite(Number(payload?.testcasesPassed))
    ? Number(payload.testcasesPassed)
    : 0;

  if (total <= 0) return true;
  if (verdict === "Accepted" && passed < total) return true;
  return false;
};

const rejudgeSubmitPayload = async (job, payload) => {
  const judgeTestcases = Array.isArray(job?.data?.judgeTestcases)
    ? job.data.judgeTestcases
    : [];
  const timeoutMs = Number.isFinite(Number(job?.data?.timeoutMs))
    ? Number(job.data.timeoutMs)
    : 5000;

  if (judgeTestcases.length === 0) return payload;

  const result = await evaluateSubmissionAgainstTestcases({
    language: String(job?.data?.language || payload.language || ""),
    code: String(job?.data?.code || payload.code || ""),
    testcases: judgeTestcases,
    timeoutMs,
  });

  return {
    ...payload,
    verdict: String(result.verdict || payload.verdict || "Runtime Error"),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    runtimeMs: Number.isFinite(Number(result.runtimeMs))
      ? Number(result.runtimeMs)
      : payload.runtimeMs,
    memoryKb: Number.isFinite(Number(result.memoryKb)) ? Number(result.memoryKb) : null,
    timedOut: Boolean(result.timedOut),
    testcasesPassed: Number.isFinite(Number(result.testcasesPassed))
      ? Number(result.testcasesPassed)
      : 0,
    testcasesTotal: Number.isFinite(Number(result.testcasesTotal))
      ? Number(result.testcasesTotal)
      : judgeTestcases.length,
    completedAt: Date.now(),
  };
};

const finalizeRunJob = async ({ io, userId, payload }) => {
  emitRunResultToUser(io, userId, payload);
};

export const registerRunCodeQueueHandlers = ({ io }) => {
  if (runQueueHandlersRegistered) return;
  runQueueHandlersRegistered = true;

  runCodeQueueEvents.on("completed", async ({ jobId }) => {
    try {
      const job = await runCodeQueue.getJob(jobId);
      if (!job) return;

      const userId = String(job.data?.userId || "");
      if (!userId) return;

      let payload = buildRunResultPayloadFromJob(job);
      const jobType = inferJobType(job);

      if (jobType === "submit" && shouldRejudgeSubmitPayload(job, payload)) {
        payload = await rejudgeSubmitPayload(job, payload);
      }

      if (jobType === "submit") {
        try {
          await finalizeSubmitJob({ io, payload });
        } catch (submitError) {
          console.error("submit finalize error:", submitError.message);
          await recordSubmission({
            status: "failed",
            requestId: payload.requestId,
            submissionType: "submit",
            userId: payload.userId,
            username: payload.username,
            problemId: payload.problemId,
            contestId: payload.contestId,
            roomCode: payload.roomCode,
            code: payload.code,
            language: payload.language,
            customInput: payload.customInput,
            verdict: payload.verdict || "Runtime Error",
            executionTime: payload.runtimeMs,
            memoryUsed: payload.memoryKb,
            stdout: payload.stdout,
            stderr: submitError.message || "Failed to finalize submission",
            testcasesPassed: Number(payload.testcasesPassed || 0),
            testcasesTotal: Number(payload.testcasesTotal || 0),
            scoreDelta: 0,
            penaltyDelta: 0,
          });
          io.to(`user:${payload.userId}`).emit("submission-result", {
            ok: false,
            code: "INTERNAL_ERROR",
            message: "Submission finalize failed",
            data: payload,
          });
        }
        return;
      }

      await finalizeRunJob({ io, userId, payload });
    } catch (error) {
      console.error("run queue completed handler error:", error.message);
    }
  });

  runCodeQueueEvents.on("failed", async ({ jobId, failedReason }) => {
    try {
      const job = await runCodeQueue.getJob(jobId);
      if (!job) return;

      const userId = String(job.data?.userId || "");
      if (!userId) return;

      const payload = buildRunResultPayloadFromJob(job, {
        verdict: "Runtime Error",
        stderr: String(failedReason || "Execution failed"),
        stdout: "",
        completedAt: Date.now(),
      });
      const jobType = inferJobType(job);

      if (jobType === "submit") {
        await recordSubmission({
          status: "failed",
          requestId: payload.requestId,
          submissionType: "submit",
          userId: String(job.data?.userId || ""),
          username: String(job.data?.username || ""),
          problemId: String(job.data?.problemId || ""),
          contestId: String(job.data?.contestId || ""),
          roomCode: String(job.data?.roomCode || ""),
          code: String(job.data?.code || ""),
          language: String(job.data?.language || ""),
          customInput: "",
          verdict: "Runtime Error",
          executionTime: payload.runtimeMs,
          memoryUsed: payload.memoryKb,
          stdout: payload.stdout,
          stderr: payload.stderr,
          testcasesPassed: 0,
          testcasesTotal: 0,
          scoreDelta: 0,
          penaltyDelta: 0,
        });

        io.to(`user:${userId}`).emit("submission-result", {
          ok: false,
          code: "INTERNAL_ERROR",
          message: payload.stderr || "Submission execution failed",
          data: payload,
        });
      } else {
        emitRunResultToUser(io, userId, payload);
      }
    } catch (error) {
      console.error("run queue failed handler error:", error.message);
    }
  });

  runCodeQueueEvents.on("error", (error) => {
    console.error("run queue events stream error:", error.message);
  });
};

export const enqueueJudgeJob = async (jobData) => {
  const jobType = String(jobData?.type || "run");
  const jobName = jobType === "submit" ? "submit-code" : RUN_CODE_JOB_NAME;
  return runCodeQueue.add(jobName, jobData, {
    attempts: 1,
  });
};

export const ensureRunCodeQueueReady = async () => {
  await Promise.all([runCodeQueue.waitUntilReady(), runCodeQueueEvents.waitUntilReady()]);
};

export const closeRunCodeQueueResources = async () => {
  await Promise.allSettled([
    runCodeQueueEvents.close(),
    runCodeQueue.close(),
    queueConnection.quit(),
    queueEventsConnection.quit(),
  ]);
};
