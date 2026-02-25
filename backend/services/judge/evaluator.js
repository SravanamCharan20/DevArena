import { executeCodeRun } from "./dockerRunner.js";

const normalizeOutput = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();

export const evaluateSubmissionAgainstTestcases = async ({
  language,
  code,
  testcases,
  timeoutMs,
}) => {
  const cases = Array.isArray(testcases) ? testcases : [];
  const total = cases.length;

  if (total === 0) {
    return {
      verdict: "Runtime Error",
      stdout: "",
      stderr: "No judge testcases configured for this problem",
      runtimeMs: 0,
      memoryKb: null,
      timedOut: false,
      testcasesPassed: 0,
      testcasesTotal: 0,
    };
  }

  let cumulativeRuntimeMs = 0;
  let maxMemoryKb = 0;
  let passed = 0;

  for (const testcase of cases) {
    const result = await executeCodeRun({
      language,
      code,
      stdin: String(testcase?.input || ""),
      timeoutMs,
    });

    cumulativeRuntimeMs += Number.isFinite(Number(result.runtimeMs))
      ? Number(result.runtimeMs)
      : 0;
    if (Number.isFinite(Number(result.memoryKb))) {
      maxMemoryKb = Math.max(maxMemoryKb, Number(result.memoryKb));
    }

    if (result.verdict !== "Accepted") {
      return {
        verdict: result.verdict,
        stdout: result.stdout,
        stderr: result.stderr,
        runtimeMs: cumulativeRuntimeMs,
        memoryKb: maxMemoryKb || null,
        timedOut: Boolean(result.timedOut),
        testcasesPassed: passed,
        testcasesTotal: total,
      };
    }

    const actual = normalizeOutput(result.stdout);
    const expected = normalizeOutput(testcase?.output);

    if (actual !== expected) {
      return {
        verdict: "Wrong Answer",
        stdout: result.stdout,
        stderr: "",
        runtimeMs: cumulativeRuntimeMs,
        memoryKb: maxMemoryKb || null,
        timedOut: false,
        testcasesPassed: passed,
        testcasesTotal: total,
      };
    }

    passed += 1;
  }

  return {
    verdict: "Accepted",
    stdout: "All hidden testcases passed.",
    stderr: "",
    runtimeMs: cumulativeRuntimeMs,
    memoryKb: maxMemoryKb || null,
    timedOut: false,
    testcasesPassed: total,
    testcasesTotal: total,
  };
};

