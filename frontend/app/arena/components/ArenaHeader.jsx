import React from "react";

const ArenaHeader = ({
  contest,
  roomCode,
  isHost,
  leaderboardOpen,
  setLeaderboardOpen,
  sortedLeaderboard,
  timerText,
  connected,
  endingContest,
  error,
}) => {
  return (
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
      {endingContest ? <p className="mt-2 text-sm text-amber-400">Ending contest...</p> : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
};

export default ArenaHeader;
