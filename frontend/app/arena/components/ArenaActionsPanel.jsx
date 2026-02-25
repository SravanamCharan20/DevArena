import React from "react";

const ArenaActionsPanel = ({
  handleLeaveArena,
  leaving,
  isHost,
  handleCloseRoom,
  closing,
}) => {
  return (
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
  );
};

export default ArenaActionsPanel;
