"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SurfaceCard from "../../components/ui/SurfaceCard";
import PageHeader from "../../components/ui/PageHeader";
import StatusMessage from "../../components/ui/StatusMessage";
import { useSocket } from "../../utils/SocketProvider";
import { useUser } from "../../utils/UserContext";
import { API_BASE_URL } from "../../utils/config";

const CreateRoomPage = () => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [problems, setProblems] = useState([]);
  const [selectedProblemIds, setSelectedProblemIds] = useState([]);
  const [contestTitle, setContestTitle] = useState("");
  const [contestDescription, setContestDescription] = useState("");
  const [duration, setDuration] = useState(90);
  const { socket, connected } = useSocket();
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  const selectedProblemsCount = selectedProblemIds.length;
  const hasProblems = problems.length > 0;

  useEffect(() => {
    if (userLoading || !user) return;
    if (user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }

    const fetchProblems = async () => {
      setLoadingProblems(true);
      try {
        const res = await fetch(`${API_BASE_URL}/contest/problems`, {
          credentials: "include",
        });
        const data = await res.json();

        if (!res.ok || !data?.success) {
          throw new Error(data?.message || "Could not load problems");
        }

        const fetchedProblems = Array.isArray(data.problems) ? data.problems : [];
        setProblems(fetchedProblems);
      } catch (err) {
        setError(err.message || "Could not load problems");
        setProblems([]);
      } finally {
        setLoadingProblems(false);
      }
    };

    fetchProblems();
  }, [userLoading, user, router]);

  const problemSelectionSummary = useMemo(() => {
    if (loadingProblems) return "Loading problems...";
    if (!hasProblems) return "No problems available.";
    return `${selectedProblemsCount} selected out of ${problems.length}`;
  }, [loadingProblems, hasProblems, selectedProblemsCount, problems.length]);

  const toggleProblem = (problemId) => {
    setSelectedProblemIds((prev) =>
      prev.includes(problemId)
        ? prev.filter((id) => id !== problemId)
        : [...prev, problemId]
    );
  };

  const handleSet = () => {
    if (!user || user.role !== "admin") {
      setError("Only admin can create rooms");
      return;
    }

    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    if (selectedProblemIds.length === 0) {
      setError("Select at least one problem");
      return;
    }

    setError("");
    setLoading(true);

    socket.emit(
      "create-room",
      {
        problemIds: selectedProblemIds,
        contestTitle: contestTitle.trim(),
        contestDescription: contestDescription.trim(),
        duration: Number(duration),
      },
      (ack) => {
        setLoading(false);
        if (!ack?.ok) {
          setError(ack?.message || "Could not create room");
          return;
        }

        const nextRoomCode = ack?.data?.roomCode;
        if (!nextRoomCode) {
          setError("Could not create room");
          return;
        }

        router.push(`/lobby?room=${nextRoomCode}`);
      }
    );
  };

  if (userLoading || !user) return null;
  if (user.role !== "admin") return null;

  return (
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.12fr_0.88fr]">
        <SurfaceCard className="p-7 sm:p-9">
          <PageHeader
            eyebrow="Admin only"
            title="Create room with contest problems"
            description="Choose problems and contest settings before entering lobby."
          />

          {!connected ? (
            <StatusMessage variant="warn" role="status" className="mb-4">
              Reconnecting to live server...
            </StatusMessage>
          ) : null}

          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Contest title</span>
              <input
                type="text"
                className="input"
                value={contestTitle}
                onChange={(event) => setContestTitle(event.target.value)}
                placeholder="Room Contest"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Contest description</span>
              <textarea
                className="input min-h-24"
                value={contestDescription}
                onChange={(event) => setContestDescription(event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Duration (minutes)</span>
              <input
                type="number"
                min="5"
                max="720"
                className="input"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </label>
          </div>

          <button
            onClick={handleSet}
            disabled={loading || selectedProblemIds.length === 0 || !hasProblems}
            className="btn btn-primary mt-6 w-full cursor-pointer py-3"
          >
            {loading ? "Creating..." : "Create Room and Enter Lobby"}
          </button>

          <StatusMessage variant="error" role="alert" className="mt-3">
            {error}
          </StatusMessage>
        </SurfaceCard>

        <SurfaceCard className="p-7 sm:p-9">
          <h2 className="text-lg font-semibold">Select problems</h2>
          <p className="body-muted mt-2 text-sm">{problemSelectionSummary}</p>

          {loadingProblems ? (
            <p className="status status-info mt-4">Loading problems...</p>
          ) : !hasProblems ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <p className="text-sm">No problems found.</p>
              <Link href="/problems" className="btn btn-secondary mt-3 w-full py-3">
                Create problem first
              </Link>
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {problems.map((problem) => {
                const isSelected = selectedProblemIds.includes(problem._id);
                return (
                  <li
                    key={problem._id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProblem(problem._id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{problem.title}</p>
                          <span className="chip">{problem.difficulty}</span>
                        </div>
                        <p className="body-muted mt-1 text-sm">{problem.slug}</p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default CreateRoomPage;
