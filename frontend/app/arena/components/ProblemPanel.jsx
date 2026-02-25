import React from "react";

const PROBLEM_TABS = [
  ["description", "Description"],
  ["examples", "Examples"],
  ["constraints", "Constraints"],
];

const ProblemPanel = ({
  contest,
  contestLoading,
  selectedProblem,
  selectedProblemId,
  setSelectedProblemId,
  problemTab,
  setProblemTab,
  problemStatusMap,
  selectedProblemStatus,
  getStatusChipClasses,
}) => {
  return (
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
        {PROBLEM_TABS.map(([id, label]) => (
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
                    <h4 className="mb-2 text-sm font-semibold text-[var(--text)]">
                      Input format
                    </h4>
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
  );
};

export default ProblemPanel;
