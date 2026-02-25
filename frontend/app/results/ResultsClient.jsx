"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import PageHeader from "../components/ui/PageHeader";
import StatusMessage from "../components/ui/StatusMessage";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";

const formatDateTime = (timestamp) => {
  if (!Number.isFinite(Number(timestamp))) return "--";
  return new Date(Number(timestamp)).toLocaleString();
};

const ResultsClient = ({ roomCode }) => {
  const router = useRouter();
  const { refreshActiveRoom } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFinishedRoom, setNotFinishedRoom] = useState(null);
  const [results, setResults] = useState(null);

  const invalidRoomCode = !roomCode;

  const fetchResults = useCallback(async () => {
    if (invalidRoomCode) {
      setError("Invalid room code");
      setNotFinishedRoom(null);
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/contest/rooms/${roomCode}/results`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();

      if (res.status === 409 && data?.code === "CONTEST_NOT_FINISHED") {
        setResults(null);
        setNotFinishedRoom(data?.room || null);
        setError(data?.message || "Contest is not finished yet");
        return;
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not load contest results");
      }

      setError("");
      setNotFinishedRoom(null);
      setResults(data);
      await refreshActiveRoom();
    } catch (err) {
      setResults(null);
      setNotFinishedRoom(null);
      setError(err?.message || "Could not load contest results");
    } finally {
      setLoading(false);
    }
  }, [invalidRoomCode, refreshActiveRoom, roomCode]);

  useEffect(() => {
    void fetchResults();
  }, [fetchResults]);

  const standings = useMemo(
    () => (Array.isArray(results?.standings) ? results.standings : []),
    [results?.standings]
  );

  const problemById = useMemo(() => {
    const problems = Array.isArray(results?.problems) ? results.problems : [];
    return new Map(problems.map((problem) => [String(problem._id), problem]));
  }, [results?.problems]);

  const summaryByUserId = useMemo(() => {
    const submissionSummary = Array.isArray(results?.submissionSummary)
      ? results.submissionSummary
      : [];
    return new Map(
      submissionSummary.map((entry) => [String(entry.userId || ""), entry])
    );
  }, [results?.submissionSummary]);

  const isContestStillRunning =
    String(notFinishedRoom?.status || "") === "running" ||
    String(notFinishedRoom?.status || "") === "lobby";

  const handleOpenLiveRoom = () => {
    if (!notFinishedRoom?.roomCode) {
      router.push("/dashboard");
      return;
    }

    if (notFinishedRoom.status === "running") {
      router.push(`/arena?room=${notFinishedRoom.roomCode}`);
      return;
    }

    router.push(`/lobby?room=${notFinishedRoom.roomCode}`);
  };

  return (
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.12fr_0.88fr]">
        <SurfaceCard className="p-6 sm:p-8">
          <PageHeader
            eyebrow="Contest results"
            title={`Room ${roomCode || "N/A"}`}
            description="Final standings are locked once contest ends."
            aside={
              results?.room?.status ? (
                <span className="chip">{String(results.room.status).toUpperCase()}</span>
              ) : null
            }
          />

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={fetchResults}
              disabled={loading}
              className="btn btn-secondary cursor-pointer px-4 py-2 text-sm"
            >
              {loading ? "Refreshing..." : "Refresh Results"}
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="btn btn-primary cursor-pointer px-4 py-2 text-sm"
            >
              Back to Dashboard
            </button>
          </div>

          {loading ? (
            <StatusMessage variant="info" role="status">
              Loading contest results...
            </StatusMessage>
          ) : error ? (
            <StatusMessage variant="error" role="alert">
              {error}
            </StatusMessage>
          ) : standings.length === 0 ? (
            <StatusMessage variant="info" role="status">
              No final standings available.
            </StatusMessage>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-strong)]">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-soft)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Rank</th>
                    <th className="px-3 py-2 font-semibold">Participant</th>
                    <th className="px-3 py-2 font-semibold">Score</th>
                    <th className="px-3 py-2 font-semibold">Penalty</th>
                    <th className="px-3 py-2 font-semibold">Solved</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((standing) => (
                    <tr
                      key={standing.userId}
                      className="border-b border-[var(--border)]/70 last:border-b-0"
                    >
                      <td className="px-3 py-2 font-semibold">#{standing.rank || "-"}</td>
                      <td className="px-3 py-2">{standing.username}</td>
                      <td className="px-3 py-2">{standing.score}</td>
                      <td className="px-3 py-2">{standing.penalty}</td>
                      <td className="px-3 py-2">{standing.solvedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="h-fit p-6 sm:p-8 lg:sticky lg:top-24">
          <h3 className="text-lg font-semibold">Submission summary</h3>
          <p className="body-muted mt-2 text-sm">
            Per-user attempts and solved coverage by problem.
          </p>

          {isContestStillRunning ? (
            <>
              <StatusMessage variant="warn" role="status" className="mt-4">
                Contest is still active for this room.
              </StatusMessage>
              <button
                onClick={handleOpenLiveRoom}
                className="btn btn-secondary mt-3 w-full cursor-pointer py-3"
              >
                Open Live Room
              </button>
            </>
          ) : null}

          {!loading && !error && standings.length > 0 ? (
            <div className="mt-4 space-y-3">
              {standings.map((standing) => {
                const summary = summaryByUserId.get(String(standing.userId || ""));
                const byProblem = Array.isArray(summary?.byProblem) ? summary.byProblem : [];

                return (
                  <div
                    key={`${standing.userId}-summary`}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-semibold">{standing.username}</p>
                      <span className="chip">Rank #{standing.rank || "-"}</span>
                    </div>

                    <p className="body-muted text-xs">
                      Submissions: {summary?.totalSubmissions || 0} | Accepted:{" "}
                      {summary?.acceptedSubmissions || 0} | Failed:{" "}
                      {summary?.failedSubmissions || 0}
                    </p>
                    <p className="body-muted mt-1 text-xs">
                      Score delta: {summary?.totalScoreDelta || 0} | Penalty delta:{" "}
                      {summary?.totalPenaltyDelta || 0}
                    </p>
                    <p className="body-muted mt-1 text-xs">
                      Last submission: {formatDateTime(summary?.lastSubmissionAt)}
                    </p>

                    {byProblem.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {byProblem.map((entry) => {
                          const problem = problemById.get(String(entry.problemId || ""));
                          const label = problem?.title || `Problem ${String(entry.problemId).slice(-6)}`;
                          return (
                            <span
                              key={`${standing.userId}-${entry.problemId}`}
                              className={
                                entry.accepted
                                  ? "rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300"
                                  : "rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                              }
                            >
                              {label} ({entry.attempts})
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default ResultsClient;
