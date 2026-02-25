"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSocket } from "../utils/SocketProvider";
import { useTheme } from "../utils/ThemeProvider";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";
import ArenaHeader from "./components/ArenaHeader";
import ProblemPanel from "./components/ProblemPanel";
import EditorPanel from "./components/EditorPanel";
import ConsolePanel from "./components/ConsolePanel";
import RecentSubmissionsPanel from "./components/RecentSubmissionsPanel";
import ArenaActionsPanel from "./components/ArenaActionsPanel";
import {
  buildDraftStorageKey,
  buildProblemStatusMap,
  cloneDefaultSnippets,
  createRunResultText,
  formatDuration,
  formatSubmissionTime,
  getStatusChipClasses,
  LANGUAGE_TO_MONACO,
  normalizeSubmissionEntry,
  readDraftFromStorage,
  SUBMISSION_HISTORY_LIMIT,
  submissionSortValue,
  upsertSubmissionHistory,
  writeDraftToStorage,
} from "./arenaHelpers";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
      Loading editor...
    </div>
  ),
});

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
      const res = await fetch(`${API_BASE_URL}/contest/rooms/${roomCode}/leaderboard`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data?.success) return;
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
      setHostUserId(typeof ack?.data?.hostUserId === "string" ? ack.data.hostUserId : "");
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
    if (invalidRoomCode || !connected) {
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
      <ArenaHeader
        contest={contest}
        roomCode={roomCode}
        isHost={isHost}
        leaderboardOpen={leaderboardOpen}
        setLeaderboardOpen={setLeaderboardOpen}
        sortedLeaderboard={sortedLeaderboard}
        timerText={timerText}
        connected={connected}
        endingContest={endingContest}
        error={error}
      />

      <div className="grid min-h-[calc(100vh-220px)] grid-cols-1 gap-3 xl:grid-cols-[minmax(360px,44%)_minmax(500px,56%)]">
        <ProblemPanel
          contest={contest}
          contestLoading={contestLoading}
          selectedProblem={selectedProblem}
          selectedProblemId={selectedProblemId}
          setSelectedProblemId={setSelectedProblemId}
          problemTab={problemTab}
          setProblemTab={setProblemTab}
          problemStatusMap={problemStatusMap}
          selectedProblemStatus={selectedProblemStatus}
          getStatusChipClasses={getStatusChipClasses}
        />

        <section className="grid min-h-[640px] grid-rows-[minmax(320px,52%)_minmax(240px,28%)_minmax(170px,20%)_auto] gap-3">
          <EditorPanel
            language={language}
            setLanguage={setLanguage}
            resolvedTheme={resolvedTheme}
            activeCode={activeCode}
            onCodeChange={(nextCode) =>
              setCodeByLanguage((prev) => ({
                ...prev,
                [language]: nextCode,
              }))
            }
            MonacoEditor={MonacoEditor}
            languageToMonaco={LANGUAGE_TO_MONACO}
          />

          <ConsolePanel
            consoleTab={consoleTab}
            setConsoleTab={setConsoleTab}
            customInput={customInput}
            setCustomInput={setCustomInput}
            handleRunCode={handleRunCode}
            handleResetRunner={handleResetRunner}
            handleSubmitCode={handleSubmitCode}
            runningCode={runningCode}
            submittingCode={submittingCode}
            runOutput={runOutput}
            runStatus={runStatus}
          />

          <RecentSubmissionsPanel
            fetchSubmissionHistory={fetchSubmissionHistory}
            submissionsLoading={submissionsLoading}
            recentSubmissions={recentSubmissions}
            visibleRecentSubmissions={visibleRecentSubmissions}
            userId={user?._id}
            formatSubmissionTime={formatSubmissionTime}
          />

          <ArenaActionsPanel
            handleLeaveArena={handleLeaveArena}
            leaving={leaving}
            isHost={isHost}
            handleCloseRoom={handleCloseRoom}
            closing={closing}
          />
        </section>
      </div>
    </div>
  );
};

export default ArenaClient;
