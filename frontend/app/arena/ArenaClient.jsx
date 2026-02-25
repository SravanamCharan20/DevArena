"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import StatusMessage from "../components/ui/StatusMessage";
import { useSocket } from "../utils/SocketProvider";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";

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

const DEFAULT_EDITOR_CODE = `# Write your solution here
def solve():
    pass`;

const ArenaClient = ({ roomCode }) => {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const { user, refreshActiveRoom } = useUser();
  const invalidRoomCode = !roomCode;

  const [hostUserId, setHostUserId] = useState("");
  const [error, setError] = useState("");
  const [contestLoading, setContestLoading] = useState(true);
  const [contest, setContest] = useState(null);
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [members, setMembers] = useState([]);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [contestEndAt, setContestEndAt] = useState(null);
  const [timeLeftMs, setTimeLeftMs] = useState(null);

  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState(DEFAULT_EDITOR_CODE);
  const [customInput, setCustomInput] = useState("");
  const [runOutput, setRunOutput] = useState("");
  const [runStatus, setRunStatus] = useState("");

  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [endingContest, setEndingContest] = useState(false);

  const contestEndRequestedRef = useRef(false);

  const isHost = Boolean(user?._id && hostUserId && user._id === hostUserId);

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
      return;
    }

    setRunStatus("Run completed");
    setRunOutput("Judge integration pending. Configure executor to run code.");
  };

  const handleResetRunner = () => {
    setCustomInput("");
    setRunStatus("");
    setRunOutput("");
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
    <div className="page-wrap">
      <div className="content-grid">
        <SurfaceCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="chip">Contest running</p>
              <h1 className="section-title mt-3">DevArena</h1>
              <p className="body-muted mt-2 text-sm">
                {contest?.title || "Contest is live"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setLeaderboardOpen((prev) => !prev)}
                className="chip cursor-pointer"
              >
                Leaderboard
              </button>
              <span className="chip">Time Left {timerText}</span>
              <span className="chip">Room {roomCode || "N/A"}</span>
            </div>
          </div>

          {leaderboardOpen ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <h3 className="text-sm font-semibold">Live leaderboard</h3>
              {sortedLeaderboard.length === 0 ? (
                <p className="status status-info mt-2">No members yet.</p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {sortedLeaderboard.map((member, index) => (
                    <li
                      key={member.userId}
                      className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1.5 text-sm"
                    >
                      <span>
                        {index + 1}. {member.username}
                      </span>
                      <span>{Number.isFinite(Number(member?.score)) ? member.score : 0}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}

          {!connected ? (
            <StatusMessage variant="warn" role="status" className="mt-4">
              Reconnecting to live server...
            </StatusMessage>
          ) : null}

          {endingContest ? (
            <StatusMessage variant="warn" role="status" className="mt-3">
              Ending contest...
            </StatusMessage>
          ) : null}

          <StatusMessage variant="error" role="alert" className="mt-3">
            {error}
          </StatusMessage>
        </SurfaceCard>

        <div className="content-grid lg:grid-cols-[1fr_0.65fr_1fr]">
          <SurfaceCard className="min-h-[560px] p-6 sm:p-7">
            <h2 className="text-lg font-semibold">Problem</h2>
            {contestLoading ? (
              <p className="status status-info mt-3">Loading problem...</p>
            ) : !selectedProblem ? (
              <p className="status status-info mt-3">No problem mapped to this contest.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xl font-semibold">{selectedProblem.title}</h3>
                  <span className="chip">{selectedProblem.difficulty}</span>
                </div>

                <p className="body-muted whitespace-pre-wrap text-sm sm:text-base">
                  {selectedProblem.description}
                </p>

                {selectedProblem.inputFormat ? (
                  <div>
                    <h4 className="text-sm font-semibold">Input format</h4>
                    <p className="body-muted mt-1 whitespace-pre-wrap text-sm">
                      {selectedProblem.inputFormat}
                    </p>
                  </div>
                ) : null}

                {selectedProblem.outputFormat ? (
                  <div>
                    <h4 className="text-sm font-semibold">Output format</h4>
                    <p className="body-muted mt-1 whitespace-pre-wrap text-sm">
                      {selectedProblem.outputFormat}
                    </p>
                  </div>
                ) : null}

                {selectedProblem.constraints ? (
                  <div>
                    <h4 className="text-sm font-semibold">Constraints</h4>
                    <p className="body-muted mt-1 whitespace-pre-wrap text-sm">
                      {selectedProblem.constraints}
                    </p>
                  </div>
                ) : null}

                {Array.isArray(selectedProblem.exampleTestcases) &&
                selectedProblem.exampleTestcases.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold">Examples</h4>
                    <div className="mt-2 space-y-2">
                      {selectedProblem.exampleTestcases.map((example, index) => (
                        <div
                          key={`${selectedProblem._id}-example-${index}`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm"
                        >
                          <p>
                            <strong>Input:</strong> {example.input}
                          </p>
                          <p className="mt-1">
                            <strong>Output:</strong> {example.output}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="min-h-[560px] p-6 sm:p-7">
            <h2 className="text-lg font-semibold">Run & Cases</h2>
            <p className="body-muted mt-2 text-sm">
              Test with custom input before final submit integration.
            </p>

            <label className="mt-4 block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Custom input</span>
              <textarea
                className="input min-h-40"
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
                placeholder="Paste input here"
              />
            </label>

            <div className="mt-4 flex gap-2">
              <button onClick={handleRunCode} className="btn btn-primary flex-1 cursor-pointer">
                Run
              </button>
              <button
                onClick={handleResetRunner}
                className="btn btn-secondary flex-1 cursor-pointer"
              >
                Reset
              </button>
            </div>

            {runStatus ? <p className="status status-info mt-4">{runStatus}</p> : null}

            <label className="mt-3 block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Output</span>
              <textarea
                className="input min-h-40"
                readOnly
                value={runOutput}
                placeholder="Run output appears here"
              />
            </label>
          </SurfaceCard>

          <SurfaceCard className="min-h-[560px] p-6 sm:p-7">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Editor</h2>
              <select
                className="input !w-32"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="cpp">C++</option>
              </select>
            </div>

            <textarea
              className="input mt-4 min-h-[400px] font-mono text-sm"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />

            <div className="soft-divider mt-5" />

            <div className="mt-5 space-y-3">
              <button
                onClick={handleLeaveArena}
                disabled={leaving}
                className="btn btn-danger w-full cursor-pointer py-3"
              >
                {leaving ? "Leaving..." : "Leave Arena"}
              </button>

              {isHost ? (
                <button
                  onClick={handleCloseRoom}
                  disabled={closing}
                  className="btn btn-secondary w-full cursor-pointer py-3"
                >
                  {closing ? "Closing..." : "Close Room"}
                </button>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-muted)]">
                  Only host can close room.
                </div>
              )}
            </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};

export default ArenaClient;
