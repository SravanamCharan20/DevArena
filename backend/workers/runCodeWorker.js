import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { executeCodeRun } from "../services/judge/dockerRunner.js";
import { evaluateSubmissionAgainstTestcases } from "../services/judge/evaluator.js";
import { RUN_CODE_JOB_NAME, RUN_CODE_QUEUE_NAME } from "../services/judge/constants.js";
import { validateCodePolicy } from "../services/judge/codePolicy.js";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("error", (error) => {
  console.error("run worker redis error:", error.message);
});

const worker = new Worker(
  RUN_CODE_QUEUE_NAME,
  async (job) => {
    const hasJudgeTestcases =
      Array.isArray(job.data?.judgeTestcases) && job.data.judgeTestcases.length > 0;
    const inferredTypeFromName = job.name === "submit-code" ? "submit" : "run";
    const jobType =
      inferredTypeFromName === "submit" || hasJudgeTestcases
        ? "submit"
        : String(job.data?.type || RUN_CODE_JOB_NAME) === "submit"
          ? "submit"
          : "run";
    const timeoutMs = Number.isFinite(Number(job.data?.timeoutMs))
      ? Number(job.data.timeoutMs)
      : 5000;
    const memoryLimitMb = Number.isFinite(Number(job.data?.memoryLimitMb))
      ? Number(job.data.memoryLimitMb)
      : 256;
    const language = String(job.data?.language || "");
    const code = String(job.data?.code || "");

    const policyCheck = validateCodePolicy({ language, code });
    if (!policyCheck.ok) {
      return {
        type: jobType,
        requestId: String(job.data?.requestId || ""),
        roomCode: String(job.data?.roomCode || ""),
        contestId: String(job.data?.contestId || ""),
        problemId: String(job.data?.problemId || ""),
        userId: String(job.data?.userId || ""),
        username: String(job.data?.username || ""),
        language,
        code,
        customInput: String(job.data?.customInput || ""),
        problemCredit: Number.isFinite(Number(job.data?.problemCredit))
          ? Number(job.data.problemCredit)
          : 100,
        verdict: "Runtime Error",
        stdout: "",
        stderr: policyCheck.message,
        runtimeMs: 0,
        memoryKb: null,
        timedOut: false,
        testcasesPassed: 0,
        testcasesTotal: Array.isArray(job.data?.judgeTestcases)
          ? job.data.judgeTestcases.length
          : 0,
        completedAt: Date.now(),
      };
    }

    const result =
      jobType === "submit"
        ? await evaluateSubmissionAgainstTestcases({
            language,
            code,
            testcases: Array.isArray(job.data?.judgeTestcases)
              ? job.data.judgeTestcases
              : [],
            timeoutMs,
            memoryLimitMb,
          })
        : await executeCodeRun({
            language,
            code,
            stdin: String(job.data?.customInput || ""),
            timeoutMs,
            memoryLimitMb,
          });

    return {
      type: jobType,
      requestId: String(job.data?.requestId || ""),
      roomCode: String(job.data?.roomCode || ""),
      contestId: String(job.data?.contestId || ""),
      problemId: String(job.data?.problemId || ""),
      userId: String(job.data?.userId || ""),
      username: String(job.data?.username || ""),
      language,
      code,
      customInput: String(job.data?.customInput || ""),
      problemCredit: Number.isFinite(Number(job.data?.problemCredit))
        ? Number(job.data.problemCredit)
        : 100,
      ...result,
      completedAt: Date.now(),
    };
  },
  {
    connection,
    concurrency: 2,
  }
);

worker.on("ready", () => {
  console.log("Run code worker is ready.");
});

worker.on("completed", (job) => {
  console.log(`run-code job completed: ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`run-code job failed: ${job?.id || "unknown"} ${error.message}`);
});

worker.on("error", (error) => {
  console.error("run-code worker error:", error.message);
});

const shutdown = async () => {
  await Promise.allSettled([worker.close(), connection.quit()]);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
