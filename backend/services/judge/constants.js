export const RUN_CODE_QUEUE_NAME = "run-code-queue";

export const RUN_CODE_JOB_NAME = "run-code";

export const ALLOWED_RUN_LANGUAGES = new Set(["python", "javascript", "cpp"]);

export const MAX_RUN_CODE_BYTES = 200 * 1024;

export const MAX_RUN_INPUT_BYTES = 32 * 1024;

export const MAX_RUN_OUTPUT_BYTES = 128 * 1024;

export const SUBMIT_PENALTY_POINTS = 10;
