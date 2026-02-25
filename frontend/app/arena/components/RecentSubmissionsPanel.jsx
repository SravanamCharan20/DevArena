import React from "react";

const RecentSubmissionsPanel = ({
  fetchSubmissionHistory,
  submissionsLoading,
  recentSubmissions,
  visibleRecentSubmissions,
  userId,
  formatSubmissionTime,
}) => {
  return (
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
              const isCurrentUser = String(submission.userId || "") === String(userId || "");
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
  );
};

export default RecentSubmissionsPanel;
