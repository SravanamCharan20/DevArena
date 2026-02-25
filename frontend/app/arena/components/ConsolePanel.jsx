import React from "react";

const CONSOLE_TABS = [
  ["testcase", "Testcase"],
  ["result", "Result"],
];

const ConsolePanel = ({
  consoleTab,
  setConsoleTab,
  customInput,
  setCustomInput,
  handleRunCode,
  handleResetRunner,
  handleSubmitCode,
  runningCode,
  submittingCode,
  runOutput,
  runStatus,
}) => {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        {CONSOLE_TABS.map(([id, label]) => (
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
            {runStatus ? <p className="mt-2 text-sm text-[var(--text-muted)]">{runStatus}</p> : null}
          </>
        )}
      </div>
    </div>
  );
};

export default ConsolePanel;
