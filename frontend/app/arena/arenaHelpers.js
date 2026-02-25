export const DEFAULT_SNIPPETS = {
  python: `# Write your solution here
def solve():
    pass`,
  javascript: `// Write your solution here
function solve() {
  
}`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
  return 0;
}`,
};

const DRAFT_STORAGE_PREFIX = "devarena:draft:v1";
export const SUBMISSION_HISTORY_LIMIT = 100;

export const LANGUAGE_TO_MONACO = {
  python: "python",
  javascript: "javascript",
  cpp: "cpp",
};
const SUPPORTED_LANGUAGES = new Set(["python", "javascript", "cpp"]);

export const cloneDefaultSnippets = () => ({
  python: DEFAULT_SNIPPETS.python,
  javascript: DEFAULT_SNIPPETS.javascript,
  cpp: DEFAULT_SNIPPETS.cpp,
});

export const buildDraftStorageKey = ({ userId, roomCode, problemId }) => {
  const normalizedRoomCode = String(roomCode || "")
    .trim()
    .toUpperCase();
  const normalizedProblemId = String(problemId || "").trim();
  const normalizedUserId = String(userId || "anonymous").trim();

  if (!normalizedRoomCode || !normalizedProblemId) return "";
  return `${DRAFT_STORAGE_PREFIX}:${normalizedUserId}:${normalizedRoomCode}:${normalizedProblemId}`;
};

export const readDraftFromStorage = (storageKey) => {
  if (!storageKey || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const draftCodeByLanguage =
      parsed.codeByLanguage && typeof parsed.codeByLanguage === "object"
        ? parsed.codeByLanguage
        : {};

    return {
      codeByLanguage: {
        ...cloneDefaultSnippets(),
        python:
          typeof draftCodeByLanguage.python === "string"
            ? draftCodeByLanguage.python
            : DEFAULT_SNIPPETS.python,
        javascript:
          typeof draftCodeByLanguage.javascript === "string"
            ? draftCodeByLanguage.javascript
            : DEFAULT_SNIPPETS.javascript,
        cpp:
          typeof draftCodeByLanguage.cpp === "string"
            ? draftCodeByLanguage.cpp
            : DEFAULT_SNIPPETS.cpp,
      },
      customInput: typeof parsed.customInput === "string" ? parsed.customInput : "",
      language: SUPPORTED_LANGUAGES.has(String(parsed.language || ""))
        ? String(parsed.language)
        : "python",
    };
  } catch {
    return null;
  }
};

export const writeDraftToStorage = ({
  storageKey,
  codeByLanguage,
  customInput,
  language,
}) => {
  if (!storageKey || typeof window === "undefined") return;

  try {
    const payload = {
      codeByLanguage: {
        python:
          typeof codeByLanguage?.python === "string"
            ? codeByLanguage.python
            : DEFAULT_SNIPPETS.python,
        javascript:
          typeof codeByLanguage?.javascript === "string"
            ? codeByLanguage.javascript
            : DEFAULT_SNIPPETS.javascript,
        cpp:
          typeof codeByLanguage?.cpp === "string"
            ? codeByLanguage.cpp
            : DEFAULT_SNIPPETS.cpp,
      },
      customInput: typeof customInput === "string" ? customInput : "",
      language: SUPPORTED_LANGUAGES.has(String(language || ""))
        ? String(language)
        : "python",
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore localStorage failures (private mode/quota).
  }
};

export const normalizeSubmissionEntry = (item = {}) => ({
  _id: String(item._id || ""),
  requestId: String(item.requestId || ""),
  roomCode: String(item.roomCode || ""),
  contestId: item.contestId ? String(item.contestId) : null,
  problemId: item.problemId ? String(item.problemId) : null,
  userId: String(item.userId || ""),
  username: String(item.username || ""),
  verdict: String(item.verdict || "Pending"),
  status: String(item.status || "done"),
  language: String(item.language || ""),
  executionTime: Number.isFinite(Number(item.executionTime))
    ? Number(item.executionTime)
    : Number.isFinite(Number(item.runtimeMs))
      ? Number(item.runtimeMs)
      : null,
  memoryUsed: Number.isFinite(Number(item.memoryUsed))
    ? Number(item.memoryUsed)
    : Number.isFinite(Number(item.memoryKb))
      ? Number(item.memoryKb)
      : null,
  testcasesPassed: Number.isFinite(Number(item.testcasesPassed))
    ? Number(item.testcasesPassed)
    : 0,
  testcasesTotal: Number.isFinite(Number(item.testcasesTotal))
    ? Number(item.testcasesTotal)
    : 0,
  scoreDelta: Number.isFinite(Number(item.scoreDelta)) ? Number(item.scoreDelta) : 0,
  penaltyDelta: Number.isFinite(Number(item.penaltyDelta))
    ? Number(item.penaltyDelta)
    : 0,
  createdAt: Number.isFinite(Number(item.createdAt))
    ? Number(item.createdAt)
    : Number.isFinite(Number(item.completedAt))
      ? Number(item.completedAt)
      : Date.now(),
  judgedAt: Number.isFinite(Number(item.judgedAt))
    ? Number(item.judgedAt)
    : Number.isFinite(Number(item.completedAt))
      ? Number(item.completedAt)
      : null,
});

export const submissionSortValue = (item) => {
  if (Number.isFinite(Number(item?.judgedAt))) return Number(item.judgedAt);
  if (Number.isFinite(Number(item?.createdAt))) return Number(item.createdAt);
  return 0;
};

export const upsertSubmissionHistory = (current, incoming) => {
  const normalizedIncoming = normalizeSubmissionEntry(incoming);
  const next = [...current];
  const dedupeKey = normalizedIncoming.requestId || normalizedIncoming._id;
  const index = next.findIndex((item) => {
    const currentKey = String(item?.requestId || item?._id || "");
    return Boolean(dedupeKey) && currentKey === dedupeKey;
  });

  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...normalizedIncoming,
    };
  } else {
    next.unshift(normalizedIncoming);
  }

  next.sort((a, b) => submissionSortValue(b) - submissionSortValue(a));
  return next.slice(0, SUBMISSION_HISTORY_LIMIT);
};

export const buildProblemStatusMap = ({ submissions, userId }) => {
  const map = new Map();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return map;

  for (const rawSubmission of submissions) {
    const submission = normalizeSubmissionEntry(rawSubmission);
    if (!submission.problemId) continue;
    if (submission.userId !== normalizedUserId) continue;

    const currentStatus = map.get(submission.problemId) || "Unsolved";
    const accepted =
      submission.status === "done" &&
      submission.verdict === "Accepted" &&
      Number(submission.testcasesTotal || 0) > 0 &&
      Number(submission.testcasesPassed || 0) >= Number(submission.testcasesTotal || 0);

    if (accepted) {
      map.set(submission.problemId, "Solved");
      continue;
    }

    if (currentStatus !== "Solved") {
      map.set(submission.problemId, "Tried");
    }
  }

  return map;
};

export const getStatusChipClasses = (status) => {
  if (status === "Solved") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "Tried") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-300";
  }
  return "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]";
};

export const formatSubmissionTime = (timestamp) => {
  if (!Number.isFinite(Number(timestamp))) return "--";
  return new Date(Number(timestamp)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatDuration = (ms) => {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const createRunResultText = (payload = {}) => {
  const lines = [];

  lines.push(`Verdict: ${payload.verdict || "Unknown"}`);
  if (Number.isFinite(Number(payload.runtimeMs))) {
    lines.push(`Runtime: ${Number(payload.runtimeMs)} ms`);
  }
  if (Number.isFinite(Number(payload.memoryKb))) {
    lines.push(`Memory: ${Number(payload.memoryKb)} KB`);
  }
  if (payload.stdout) {
    lines.push("");
    lines.push("stdout:");
    lines.push(String(payload.stdout));
  }
  if (payload.stderr) {
    lines.push("");
    lines.push("stderr:");
    lines.push(String(payload.stderr));
  }

  return lines.join("\n");
};
