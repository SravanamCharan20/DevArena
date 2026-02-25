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

const LANGUAGE_TO_MONACO = {
  python: "python",
  javascript: "javascript",
  cpp: "cpp",
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
  const [codeByLanguage, setCodeByLanguage] = useState(DEFAULT_SNIPPETS);
  const [customInput, setCustomInput] = useState("");
  const [runOutput, setRunOutput] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [consoleTab, setConsoleTab] = useState("testcase");

  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [endingContest, setEndingContest] = useState(false);

  const contestEndRequestedRef = useRef(false);
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
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a?.username || "").localeCompare(String(b?.username || ""));
    });
  }, [members]);

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
    if (invalidRoomCode || !connected) return;

    const handleRoomClosed = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      router.push("/dashboard");
    };

    const handleContestEnded = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      router.push("/dashboard");
    };

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      const nextMembers = Array.isArray(payload.members) ? payload.members : [];
      setMembers(nextMembers);
    };

    socket.on("room-closed", handleRoomClosed);
    socket.on("contest-ended", handleContestEnded);
    socket.on("room-members-updated", handleRoomMembersUpdated);

    socket.emit("join-room", { roomCode }, async (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not enter arena");
        if (["NOT_FOUND", "BAD_STATE", "FORBIDDEN"].includes(ack?.code)) {
          await refreshActiveRoom();
          router.replace("/dashboard");
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
      await fetchContestForRoom();
    });

    return () => {
      socket.off("room-closed", handleRoomClosed);
      socket.off("contest-ended", handleContestEnded);
      socket.off("room-members-updated", handleRoomMembersUpdated);
    };
  }, [
    connected,
    fetchContestForRoom,
    invalidRoomCode,
    refreshActiveRoom,
    roomCode,
    router,
    socket,
  ]);

  const handleRunCode = () => {
    if (!selectedProblem) {
      setRunStatus("No problem selected");
      setRunOutput("");
      setConsoleTab("result");
      return;
    }

    const example = Array.isArray(selectedProblem.exampleTestcases)
      ? selectedProblem.exampleTestcases[0]
      : null;

    if (example) {
      setRunStatus("Sample run completed");
      setRunOutput(
        `Input:\n${customInput || example.input}\n\nOutput:\n${example.output}\n\nNote: Judge integration pending.`
      );
      setConsoleTab("result");
      return;
    }

    setRunStatus("Run completed");
    setRunOutput("Judge integration pending. Configure executor to run code.");
    setConsoleTab("result");
  };

  const handleResetRunner = () => {
    setCustomInput("");
    setRunStatus("");
    setRunOutput("");
    setConsoleTab("testcase");
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
      router.push("/dashboard");
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
                    <span className="text-[var(--text)]">
                      {index + 1}. {member.username}
                    </span>
                    <span className="font-semibold text-[var(--text)]">
                      {Number.isFinite(Number(member?.score)) ? member.score : 0}
                    </span>
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
                    {index + 1}. {problem.title}
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
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {selectedProblem.difficulty}
                  </span>
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

        <section className="grid min-h-[640px] grid-rows-[minmax(320px,58%)_minmax(250px,42%)_auto] gap-3">
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
                      className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                    >
                      Run
                    </button>
                    <button
                      onClick={handleResetRunner}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)]"
                    >
                      Reset
                    </button>
                    <button
                      disabled
                      className="cursor-not-allowed rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2 text-sm font-semibold text-[var(--text-muted)]"
                    >
                      Submit (Soon)
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
