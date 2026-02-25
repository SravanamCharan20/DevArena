"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSocket } from "../utils/SocketProvider";
import { useTheme } from "../utils/ThemeProvider";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
      Loading editor...
    </div>
  ),
});

const DEFAULT_SNIPPETS = {
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
const SUBMISSION_HISTORY_LIMIT = 100;

const LANGUAGE_TO_MONACO = {
  python: "python",
  javascript: "javascript",
  cpp: "cpp",
};
const SUPPORTED_LANGUAGES = new Set(["python", "javascript", "cpp"]);

const cloneDefaultSnippets = () => ({
  python: DEFAULT_SNIPPETS.python,
  javascript: DEFAULT_SNIPPETS.javascript,
  cpp: DEFAULT_SNIPPETS.cpp,
});

const buildDraftStorageKey = ({ userId, roomCode, problemId }) => {
  const normalizedRoomCode = String(roomCode || "")
    .trim()
    .toUpperCase();
  const normalizedProblemId = String(problemId || "").trim();
  const normalizedUserId = String(userId || "anonymous").trim();

  if (!normalizedRoomCode || !normalizedProblemId) return "";
  return `${DRAFT_STORAGE_PREFIX}:${normalizedUserId}:${normalizedRoomCode}:${normalizedProblemId}`;
};

const readDraftFromStorage = (storageKey) => {
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
      customInput:
        typeof parsed.customInput === "string" ? parsed.customInput : "",
      language: SUPPORTED_LANGUAGES.has(String(parsed.language || ""))
        ? String(parsed.language)
        : "python",
    };
  } catch {
    return null;
  }
};

const writeDraftToStorage = ({
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

const normalizeSubmissionEntry = (item = {}) => ({
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

const submissionSortValue = (item) => {
  if (Number.isFinite(Number(item?.judgedAt))) return Number(item.judgedAt);
  if (Number.isFinite(Number(item?.createdAt))) return Number(item.createdAt);
  return 0;
};

const upsertSubmissionHistory = (current, incoming) => {
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

const buildProblemStatusMap = ({ submissions, userId }) => {
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

const getStatusChipClasses = (status) => {
  if (status === "Solved") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "Tried") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-300";
  }
  return "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]";
};

const formatSubmissionTime = (timestamp) => {
  if (!Number.isFinite(Number(timestamp))) return "--";
  return new Date(Number(timestamp)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (ms) => {
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

const createRunResultText = (payload = {}) => {
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

const ArenaClient = ({ roomCode }) => {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const { resolvedTheme } = useTheme();
  const { user, refreshActiveRoom } = useUser();
  const invalidRoomCode = !roomCode;

  const [hostUserId, setHostUserId] = useState("");
  const [error, setError] = useState("");
  const [contestLoading, setContestLoading] = useState(true);
  const [contest, setContest] = useState(null);
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [problemTab, setProblemTab] = useState("description");
  const [members, setMembers] = useState([]);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [contestEndAt, setContestEndAt] = useState(null);
  const [timeLeftMs, setTimeLeftMs] = useState(null);

  const [language, setLanguage] = useState("python");
  const [codeByLanguage, setCodeByLanguage] = useState(cloneDefaultSnippets);
  const [customInput, setCustomInput] = useState("");
  const [runOutput, setRunOutput] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [consoleTab, setConsoleTab] = useState("testcase");
  const [runningCode, setRunningCode] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);

  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [endingContest, setEndingContest] = useState(false);

  const contestEndRequestedRef = useRef(false);
  const activeRunRequestIdRef = useRef("");
  const activeSubmitRequestIdRef = useRef("");
  const isHost = Boolean(user?._id && hostUserId && user._id === hostUserId);
  const activeCode = codeByLanguage[language] || "";

  const selectedProblem = useMemo(() => {
    if (!contest?.problems?.length) return null;
    return (
      contest.problems.find((problem) => problem._id === selectedProblemId) ||
      contest.problems[0]
    );
  }, [contest, selectedProblemId]);

  const sortedLeaderboard = useMemo(() => {
    return [...members].sort((a, b) => {
      const scoreA = Number.isFinite(Number(a?.score)) ? Number(a.score) : 0;
      const scoreB = Number.isFinite(Number(b?.score)) ? Number(b.score) : 0;
      const penaltyA = Number.isFinite(Number(a?.penalty)) ? Number(a.penalty) : 0;
      const penaltyB = Number.isFinite(Number(b?.penalty)) ? Number(b.penalty) : 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      if (penaltyA !== penaltyB) return penaltyA - penaltyB;
      return String(a?.username || "").localeCompare(String(b?.username || ""));
    });
  }, [members]);

  const draftStorageKey = useMemo(
    () =>
      buildDraftStorageKey({
        userId: user?._id,
        roomCode,
        problemId: selectedProblem?._id || selectedProblemId,
      }),
    [roomCode, selectedProblem?._id, selectedProblemId, user?._id]
  );

  const problemStatusMap = useMemo(
    () =>
      buildProblemStatusMap({
        submissions: recentSubmissions,
        userId: user?._id,
      }),
    [recentSubmissions, user?._id]
  );

  const selectedProblemStatus = selectedProblem?._id
    ? problemStatusMap.get(selectedProblem._id) || "Unsolved"
    : "Unsolved";

  const visibleRecentSubmissions = useMemo(() => {
    const filtered = selectedProblem?._id
      ? recentSubmissions.filter(
          (submission) =>
            String(submission.problemId || "") === String(selectedProblem._id)
        )
      : recentSubmissions;
    return filtered.slice(0, 8);
  }, [recentSubmissions, selectedProblem?._id]);

  const fetchContestForRoom = useCallback(async () => {
    setContestLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/contest/rooms/${roomCode}/contest`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not load contest");
      }

      const nextContest = data.contest || null;
      setContest(nextContest);

      const firstProblemId =
        Array.isArray(nextContest?.problems) && nextContest.problems.length > 0
          ? nextContest.problems[0]._id
          : "";
      setSelectedProblemId(firstProblemId);

      const startAtMs =
        typeof data?.room?.contestStartAt === "number" ? data.room.contestStartAt : null;
      const explicitEndAtMs =
        typeof data?.room?.contestEndAt === "number" ? data.room.contestEndAt : null;
      const durationMinutes = Number(nextContest?.duration);
      const fallbackEndAtMs =
        startAtMs && Number.isFinite(durationMinutes)
          ? startAtMs + durationMinutes * 60 * 1000
          : null;

      const nextEndAt = explicitEndAtMs || fallbackEndAtMs;
      setContestEndAt(nextEndAt);
      contestEndRequestedRef.current = false;
    } catch (err) {
      setContest(null);
      setSelectedProblemId("");
      setContestEndAt(null);
      setError(err.message || "Could not load contest");
    } finally {
      setContestLoading(false);
    }
  }, [roomCode]);

  const fetchLeaderboardSnapshot = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/contest/rooms/${roomCode}/leaderboard`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        return;
      }

      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      // Ignore snapshot errors; socket stream continues to work.
    }
  }, [roomCode]);

  const fetchSubmissionHistory = useCallback(async () => {
    setSubmissionsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/contest/rooms/${roomCode}/submissions?limit=${SUBMISSION_HISTORY_LIMIT}`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setRecentSubmissions([]);
        return;
      }

      const normalized = Array.isArray(data.submissions)
        ? data.submissions.map((submission) => normalizeSubmissionEntry(submission))
        : [];
      normalized.sort((a, b) => submissionSortValue(b) - submissionSortValue(a));
      setRecentSubmissions(normalized.slice(0, SUBMISSION_HISTORY_LIMIT));
    } catch {
      setRecentSubmissions([]);
    } finally {
      setSubmissionsLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    if (!contestEndAt) {
      setTimeLeftMs(null);
      return;
    }

    const tick = () => {
      const remaining = contestEndAt - Date.now();
      if (remaining <= 0) {
        setTimeLeftMs(0);
        if (!contestEndRequestedRef.current && isHost && connected) {
          contestEndRequestedRef.current = true;
          setEndingContest(true);
          socket.emit("end-contest", { roomCode }, () => {
            setEndingContest(false);
          });
        }
        return;
      }

      setTimeLeftMs(remaining);
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [contestEndAt, isHost, connected, socket, roomCode]);

  useEffect(() => {
    if (!draftStorageKey) {
      setCodeByLanguage(cloneDefaultSnippets());
      setCustomInput("");
      setDraftHydrated(false);
      return;
    }

    const draft = readDraftFromStorage(draftStorageKey);
    if (draft) {
      setCodeByLanguage(draft.codeByLanguage);
      setCustomInput(draft.customInput);
      setLanguage(draft.language);
    } else {
      setCodeByLanguage(cloneDefaultSnippets());
      setCustomInput("");
    }

    setDraftHydrated(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftHydrated || !draftStorageKey) return;

    writeDraftToStorage({
      storageKey: draftStorageKey,
      codeByLanguage,
      customInput,
      language,
    });
  }, [draftHydrated, draftStorageKey, codeByLanguage, customInput, language]);

  useEffect(() => {
    if (invalidRoomCode || !connected) return;

    const handleRoomClosed = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      if (payload.resultsReady === false) {
        router.replace("/dashboard");
        return;
      }
      router.replace(payload.resultsPath || `/results?room=${roomCode}`);
    };

    const handleContestEnded = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      router.replace(payload.resultsPath || `/results?room=${roomCode}`);
    };

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      const nextMembers = Array.isArray(payload.members) ? payload.members : [];
      setMembers(nextMembers);
    };

    const handleRunResult = (payload = {}) => {
      const data = payload?.data || {};
      const incomingRequestId = String(data.requestId || payload?.requestId || "");
      const incomingRoomCode = String(data.roomCode || payload?.roomCode || "");

      if (!activeRunRequestIdRef.current) return;
      if (incomingRequestId !== activeRunRequestIdRef.current) return;
      if (incomingRoomCode && incomingRoomCode !== roomCode) return;

      setRunningCode(false);
      setRunStatus(data.verdict || "Run completed");
      setRunOutput(createRunResultText(data));
      setConsoleTab("result");
      activeRunRequestIdRef.current = "";
    };

    const handleSubmissionResult = (payload = {}) => {
      const data = payload?.data || {};
      const incomingRequestId = String(data.requestId || payload?.requestId || "");
      const incomingRoomCode = String(data.roomCode || payload?.roomCode || "");

      if (incomingRoomCode && incomingRoomCode !== roomCode) return;

      setRecentSubmissions((prev) =>
        upsertSubmissionHistory(prev, {
          ...data,
          requestId: incomingRequestId || data.requestId,
          roomCode: incomingRoomCode || roomCode,
          userId: data.userId || user?._id,
          username: data.username || user?.username,
          createdAt: Number.isFinite(Number(data.completedAt))
            ? Number(data.completedAt)
            : Date.now(),
          judgedAt: Number.isFinite(Number(data.completedAt))
            ? Number(data.completedAt)
            : null,
        })
      );

      if (!activeSubmitRequestIdRef.current) return;
      if (incomingRequestId !== activeSubmitRequestIdRef.current) return;

      setSubmittingCode(false);
      const verdict = data.verdict || payload?.message || "Submission completed";
      const scoreDelta = Number.isFinite(Number(data.scoreDelta)) ? Number(data.scoreDelta) : 0;
      const penaltyDelta = Number.isFinite(Number(data.penaltyDelta))
        ? Number(data.penaltyDelta)
        : 0;

      if (payload?.ok === false) {
        setRunStatus(payload?.message || "Submission failed");
        setRunOutput(
          [
            `Verdict: ${verdict}`,
            Number.isFinite(Number(data.runtimeMs))
              ? `Runtime: ${Number(data.runtimeMs)} ms`
              : "",
            Number.isFinite(Number(data.memoryKb))
              ? `Memory: ${Number(data.memoryKb)} KB`
              : "",
            Number.isFinite(Number(data.testcasesPassed))
              ? `Passed: ${Number(data.testcasesPassed)} / ${Number(data.testcasesTotal || 0)}`
              : "",
            data.stdout ? `\nstdout:\n${String(data.stdout)}` : "",
            data.stderr ? `\nstderr:\n${String(data.stderr)}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
        setConsoleTab("result");
        activeSubmitRequestIdRef.current = "";
        return;
      }

      setRunStatus(verdict);
      setRunOutput(
        [
          `Verdict: ${verdict}`,
          Number.isFinite(Number(data.runtimeMs)) ? `Runtime: ${Number(data.runtimeMs)} ms` : "",
          Number.isFinite(Number(data.memoryKb)) ? `Memory: ${Number(data.memoryKb)} KB` : "",
          Number.isFinite(Number(data.testcasesPassed))
            ? `Passed: ${Number(data.testcasesPassed)} / ${Number(data.testcasesTotal || 0)}`
            : "",
          `Score Delta: ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`,
          `Penalty Delta: ${penaltyDelta >= 0 ? "+" : ""}${penaltyDelta}`,
          data.stdout ? `\nstdout:\n${String(data.stdout)}` : "",
          data.stderr ? `\nstderr:\n${String(data.stderr)}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
      setConsoleTab("result");
      activeSubmitRequestIdRef.current = "";
    };

    const handleLeaderboardUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      const nextMembers = Array.isArray(payload.members) ? payload.members : [];
      setMembers(nextMembers);
    };

    socket.on("room-closed", handleRoomClosed);
    socket.on("contest-ended", handleContestEnded);
    socket.on("room-members-updated", handleRoomMembersUpdated);
    socket.on("run-result", handleRunResult);
    socket.on("submission-result", handleSubmissionResult);
    socket.on("leaderboard-updated", handleLeaderboardUpdated);

    socket.emit("join-room", { roomCode }, async (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not enter arena");
        if (["NOT_FOUND", "BAD_STATE", "FORBIDDEN"].includes(ack?.code)) {
          await refreshActiveRoom();
          router.replace(`/results?room=${roomCode}`);
        }
        return;
      }

      if (ack?.data?.status !== "running") {
        setError("Contest has not started yet");
        router.push(`/lobby?room=${roomCode}`);
        return;
      }

      setError("");
      setHostUserId(
        typeof ack?.data?.hostUserId === "string" ? ack.data.hostUserId : ""
      );
      setMembers(Array.isArray(ack?.data?.members) ? ack.data.members : []);
      if (typeof ack?.data?.contestEndAt === "number") {
        setContestEndAt(ack.data.contestEndAt);
        contestEndRequestedRef.current = false;
      }
      await Promise.all([
        fetchContestForRoom(),
        fetchLeaderboardSnapshot(),
        fetchSubmissionHistory(),
      ]);
    });

    return () => {
      socket.off("room-closed", handleRoomClosed);
      socket.off("contest-ended", handleContestEnded);
      socket.off("room-members-updated", handleRoomMembersUpdated);
      socket.off("run-result", handleRunResult);
      socket.off("submission-result", handleSubmissionResult);
      socket.off("leaderboard-updated", handleLeaderboardUpdated);
    };
  }, [
    connected,
    fetchContestForRoom,
    fetchLeaderboardSnapshot,
    fetchSubmissionHistory,
    invalidRoomCode,
    refreshActiveRoom,
    roomCode,
    router,
    socket,
    user?._id,
    user?.username,
  ]);

  const handleRunCode = () => {
    if (!connected) {
      setRunStatus("Connecting to live server. Please wait and retry.");
      setConsoleTab("result");
      return;
    }

    if (!selectedProblem) {
      setRunStatus("No problem selected");
      setRunOutput("");
      setConsoleTab("result");
      return;
    }

    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeRunRequestIdRef.current = requestId;
    setRunningCode(true);
    setRunStatus("Queued for sandbox execution...");
    setRunOutput("");
    setConsoleTab("result");

    socket.emit(
      "run-code",
      {
        roomCode,
        problemId: selectedProblem._id,
        contestId: contest?._id,
        language,
        code: activeCode,
        customInput,
        requestId,
      },
      (ack) => {
        if (!ack?.ok) {
          setRunningCode(false);
          setRunStatus(ack?.message || "Could not run code");
          setRunOutput("");
          activeRunRequestIdRef.current = "";
          return;
        }

        setRunStatus("Running in secure container...");
      }
    );
  };

  const handleResetRunner = () => {
    setCustomInput("");
    setRunStatus("");
    setRunOutput("");
    setConsoleTab("testcase");
  };

  const handleSubmitCode = () => {
    if (!connected) {
      setRunStatus("Connecting to live server. Please wait and retry.");
      setConsoleTab("result");
      return;
    }

    if (!selectedProblem) {
      setRunStatus("No problem selected");
      setRunOutput("");
      setConsoleTab("result");
      return;
    }

    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeSubmitRequestIdRef.current = requestId;
    setSubmittingCode(true);
    setRunStatus("Submission queued for judging...");
    setRunOutput("");
    setConsoleTab("result");

    socket.emit(
      "submit-code",
      {
        roomCode,
        problemId: selectedProblem._id,
        contestId: contest?._id,
        language,
        code: activeCode,
        requestId,
      },
      (ack) => {
        if (!ack?.ok) {
          setSubmittingCode(false);
          setRunStatus(ack?.message || "Could not submit code");
          setRunOutput("");
          activeSubmitRequestIdRef.current = "";
          return;
        }

        setRunStatus("Judging against hidden testcases...");
      }
    );
  };

  const handleLeaveArena = () => {
    if (invalidRoomCode) {
      router.push("/dashboard");
      return;
    }

    if (!connected) {
      router.push("/dashboard");
      return;
    }

    setLeaving(true);
    socket.emit("leave-room", { roomCode }, async (ack) => {
      setLeaving(false);
      if (!ack?.ok && ack?.code !== "NOT_FOUND") {
        setError(ack?.message || "Could not leave arena");
        return;
      }

      await refreshActiveRoom();
      router.push("/dashboard");
    });
  };

  const handleCloseRoom = () => {
    if (!isHost) return;
    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    setClosing(true);
    socket.emit("close-room", { roomCode }, async (ack) => {
      setClosing(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not close room");
        return;
      }

      await refreshActiveRoom();
      router.push(`/results?room=${roomCode}`);
    });
  };

  const timerText =
    timeLeftMs === null ? "--:--" : formatDuration(timeLeftMs >= 0 ? timeLeftMs : 0);

  return (
    <div className="mx-auto w-[min(1800px,98vw)] py-3">
      <div className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Contest Running
            </span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">
              {contest?.title || "DevArena"}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Room {roomCode || "N/A"} · {isHost ? "Host" : "Participant"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setLeaderboardOpen((prev) => !prev)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-all ${
                leaderboardOpen
                  ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              }`}
            >
              Leaderboard
            </button>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Time Left {timerText}
            </span>
          </div>
        </div>

        {leaderboardOpen ? (
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
              <p className="font-semibold text-[var(--text)]">Live Leaderboard</p>
              <span>{sortedLeaderboard.length} members</span>
            </div>
            {sortedLeaderboard.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No members yet.</p>
            ) : (
              <ol className="grid gap-1.5">
                {sortedLeaderboard.map((member, index) => (
                  <li
                    key={member.userId}
                    className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
                  >
                    <span className="text-[var(--text)]">{index + 1}. {member.username}</span>
                    <div className="text-right">
                      <p className="font-semibold text-[var(--text)]">
                        {Number.isFinite(Number(member?.score)) ? member.score : 0} pts
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Penalty {Number.isFinite(Number(member?.penalty)) ? member.penalty : 0}
                        {" · "}
                        Solved{" "}
                        {Number.isFinite(Number(member?.solvedCount))
                          ? member.solvedCount
                          : 0}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}

        {!connected ? (
          <p className="mt-3 text-sm text-amber-400">Reconnecting to live server...</p>
        ) : null}
        {endingContest ? (
          <p className="mt-2 text-sm text-amber-400">Ending contest...</p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </div>

      <div className="grid min-h-[calc(100vh-220px)] grid-cols-1 gap-3 xl:grid-cols-[minmax(360px,44%)_minmax(500px,56%)]">
        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-base font-semibold text-[var(--text)]">Problem</h2>
            {Array.isArray(contest?.problems) && contest.problems.length > 1 ? (
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]"
                value={selectedProblemId}
                onChange={(event) => setSelectedProblemId(event.target.value)}
              >
                {contest.problems.map((problem, index) => (
                  <option key={problem._id} value={problem._id}>
                    {index + 1}. {problem.title} ·{" "}
                    {problemStatusMap.get(problem._id) || "Unsolved"}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
            {[
              ["description", "Description"],
              ["examples", "Examples"],
              ["constraints", "Constraints"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setProblemTab(id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-all ${
                  problemTab === id
                    ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)]"
                    : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {contestLoading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading problem...</p>
            ) : !selectedProblem ? (
              <p className="text-sm text-[var(--text-muted)]">No problem mapped to this contest.</p>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
                    {selectedProblem.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {selectedProblem.difficulty}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${getStatusChipClasses(
                        selectedProblemStatus
                      )}`}
                    >
                      {selectedProblemStatus}
                    </span>
                  </div>
                </div>

                {problemTab === "description" ? (
                  <div className="space-y-6">
                    <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-muted)]">
                      {selectedProblem.description}
                    </p>
                    {selectedProblem.inputFormat ? (
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-[var(--text)]">Input format</h4>
                        <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-muted)]">
                          {selectedProblem.inputFormat}
                        </p>
                      </div>
                    ) : null}
                    {selectedProblem.outputFormat ? (
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-[var(--text)]">
                          Output format
                        </h4>
                        <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-muted)]">
                          {selectedProblem.outputFormat}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {problemTab === "examples" ? (
                  <div className="space-y-3">
                    {Array.isArray(selectedProblem.exampleTestcases) &&
                    selectedProblem.exampleTestcases.length > 0 ? (
                      selectedProblem.exampleTestcases.map((example, index) => (
                        <div
                          key={`${selectedProblem._id}-example-${index}`}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                        >
                          <h4 className="mb-2 text-sm font-semibold text-[var(--text)]">
                            Example {index + 1}
                          </h4>
                          <p className="whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                            <strong>Input:</strong> {example.input}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                            <strong>Output:</strong> {example.output}
                          </p>
                          {example.explanation ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                              <strong>Explanation:</strong> {example.explanation}
                            </p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--text-muted)]">No examples available.</p>
                    )}
                  </div>
                ) : null}

                {problemTab === "constraints" ? (
                  <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-muted)]">
                    {selectedProblem.constraints || "No constraints available."}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="grid min-h-[640px] grid-rows-[minmax(320px,52%)_minmax(240px,28%)_minmax(170px,20%)_auto] gap-3">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-base font-semibold text-[var(--text)]">Code Editor</h2>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="cpp">C++</option>
              </select>
            </div>

            <div className="h-full min-h-[220px]">
              <MonacoEditor
                height="100%"
                language={LANGUAGE_TO_MONACO[language]}
                theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
                value={activeCode}
                onChange={(value) =>
                  setCodeByLanguage((prev) => ({
                    ...prev,
                    [language]: value ?? "",
                  }))
                }
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineHeight: 22,
                  smoothScrolling: true,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  tabSize: 2,
                }}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
              {[
                ["testcase", "Testcase"],
                ["result", "Result"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setConsoleTab(id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-all ${
                    consoleTab === id
                      ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)]"
                      : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto px-4 py-3">
              {consoleTab === "testcase" ? (
                <>
                  <label
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]"
                    htmlFor="custom-input"
                  >
                    Custom Input
                  </label>
                  <textarea
                    id="custom-input"
                    className="min-h-[150px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--border-strong)]"
                    value={customInput}
                    onChange={(event) => setCustomInput(event.target.value)}
                    placeholder="Paste input here"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleRunCode}
                      disabled={runningCode || submittingCode}
                      className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                    >
                      {runningCode ? "Running..." : "Run"}
                    </button>
                    <button
                      onClick={handleResetRunner}
                      disabled={runningCode || submittingCode}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)]"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleSubmitCode}
                      disabled={runningCode || submittingCode}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submittingCode ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label
                    className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]"
                    htmlFor="run-output"
                  >
                    Output
                  </label>
                  <textarea
                    id="run-output"
                    readOnly
                    className="min-h-[170px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none"
                    value={runOutput}
                    placeholder="Run output appears here"
                  />
                  {runStatus ? (
                    <p className="mt-2 text-sm text-[var(--text-muted)]">{runStatus}</p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
              <h2 className="text-sm font-semibold text-[var(--text)]">Recent Submissions</h2>
              <button
                onClick={fetchSubmissionHistory}
                disabled={submissionsLoading}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submissionsLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="flex-1 overflow-auto px-3 py-2.5">
              {submissionsLoading && recentSubmissions.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Loading submissions...</p>
              ) : visibleRecentSubmissions.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No submissions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {visibleRecentSubmissions.map((submission) => {
                    const isCurrentUser =
                      String(submission.userId || "") === String(user?._id || "");
                    const verdict = String(submission.verdict || "Pending");
                    const verdictChipClass =
                      verdict === "Accepted"
                        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                        : verdict === "Pending"
                          ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
                          : "border-rose-400/30 bg-rose-500/10 text-rose-300";

                    return (
                      <li
                        key={submission.requestId || submission._id}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">
                              {submission.username || "Unknown"}
                              {isCurrentUser ? " (you)" : ""}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {submission.language || "--"} ·{" "}
                              {formatSubmissionTime(submission.judgedAt || submission.createdAt)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${verdictChipClass}`}
                          >
                            {verdict}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          Score {submission.scoreDelta >= 0 ? "+" : ""}
                          {submission.scoreDelta} · Penalty {submission.penaltyDelta >= 0 ? "+" : ""}
                          {submission.penaltyDelta}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 shadow-[var(--shadow-md)]">
            <button
              onClick={handleLeaveArena}
              disabled={leaving}
              className="mb-2 w-full rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {leaving ? "Leaving..." : "Leave Arena"}
            </button>

            {isHost ? (
              <button
                onClick={handleCloseRoom}
                disabled={closing}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {closing ? "Closing..." : "Close Room"}
              </button>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
                Only host can close room.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ArenaClient;
