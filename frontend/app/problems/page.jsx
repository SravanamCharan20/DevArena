"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import PageHeader from "../components/ui/PageHeader";
import StatusMessage from "../components/ui/StatusMessage";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";
import { buildCsrfHeaders } from "../utils/csrf";

const emptyProblemForm = {
  title: "",
  description: "",
  difficulty: "Easy",
  inputFormat: "",
  outputFormat: "",
  constraints: "",
  tags: "",
  timeLimit: "1000",
  memoryLimit: "256",
  credit: "100",
  exampleInput: "",
  exampleOutput: "",
  hiddenInput: "",
  hiddenOutput: "",
};

const difficultyOptions = ["Easy", "Medium", "Hard"];

const firstTestcaseField = (testcases, key) => {
  if (!Array.isArray(testcases) || testcases.length === 0) return "";
  return String(testcases[0]?.[key] || "");
};

const parseProblemPayload = ({ form, isEdit }) => {
  const tags = form.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const hiddenInput = form.hiddenInput.trim();
  const hiddenOutput = form.hiddenOutput.trim();

  const oneHiddenProvided = Boolean(hiddenInput) !== Boolean(hiddenOutput);
  if (oneHiddenProvided) {
    throw new Error("Hidden input and output should both be provided");
  }

  const payload = {
    title: form.title.trim(),
    description: form.description.trim(),
    difficulty: form.difficulty,
    inputFormat: form.inputFormat.trim(),
    outputFormat: form.outputFormat.trim(),
    constraints: form.constraints.trim(),
    tags,
    credit: Number(form.credit || 100),
    timeLimit: Number(form.timeLimit || 1000),
    memoryLimit: Number(form.memoryLimit || 256),
    exampleTestcases:
      form.exampleInput.trim() && form.exampleOutput.trim()
        ? [
            {
              input: form.exampleInput.trim(),
              output: form.exampleOutput.trim(),
            },
          ]
        : [],
  };

  if (!isEdit || (hiddenInput && hiddenOutput)) {
    payload.hiddenTestcases =
      hiddenInput && hiddenOutput
        ? [
            {
              input: hiddenInput,
              output: hiddenOutput,
            },
          ]
        : [];
  }

  return payload;
};

const ProblemsPage = () => {
  const router = useRouter();
  const { user, loading } = useUser();
  const [form, setForm] = useState(emptyProblemForm);
  const [editingProblemId, setEditingProblemId] = useState("");
  const [problems, setProblems] = useState([]);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionProblemId, setActionProblemId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isAdmin = user?.role === "admin";

  const isEditing = Boolean(editingProblemId);
  const submitLabel = useMemo(() => {
    if (submitting) return isEditing ? "Saving..." : "Creating...";
    return isEditing ? "Save Changes" : "Create Problem";
  }, [isEditing, submitting]);

  const fetchProblems = async () => {
    setLoadingProblems(true);
    try {
      const res = await fetch(`${API_BASE_URL}/contest/problems?includeArchived=1`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not load problems");
      }

      setProblems(Array.isArray(data.problems) ? data.problems : []);
    } catch (err) {
      setError(err.message || "Could not load problems");
      setProblems([]);
    } finally {
      setLoadingProblems(false);
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    if (!isAdmin) {
      router.replace("/dashboard");
      return;
    }
    void fetchProblems();
  }, [loading, user, isAdmin, router]);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm(emptyProblemForm);
    setEditingProblemId("");
  };

  const handleCreateOrUpdateProblem = async (event) => {
    event.preventDefault();
    if (!isAdmin) return;

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const payload = parseProblemPayload({ form, isEdit: isEditing });

      const res = await fetch(
        isEditing
          ? `${API_BASE_URL}/contest/problems/${editingProblemId}`
          : `${API_BASE_URL}/contest/problems`,
        {
          method: isEditing ? "PATCH" : "POST",
          credentials: "include",
          headers: buildCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not save problem");
      }

      setSuccess(isEditing ? "Problem updated successfully" : "Problem created successfully");
      resetForm();
      await fetchProblems();
    } catch (err) {
      setError(err.message || "Could not save problem");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditProblem = (problem) => {
    setError("");
    setSuccess("");
    setEditingProblemId(String(problem._id || ""));
    setForm({
      title: String(problem.title || ""),
      description: String(problem.description || ""),
      difficulty: difficultyOptions.includes(String(problem.difficulty))
        ? String(problem.difficulty)
        : "Easy",
      inputFormat: String(problem.inputFormat || ""),
      outputFormat: String(problem.outputFormat || ""),
      constraints: String(problem.constraints || ""),
      tags: Array.isArray(problem.tags) ? problem.tags.join(", ") : "",
      timeLimit: String(problem.timeLimit || 1000),
      memoryLimit: String(problem.memoryLimit || 256),
      credit: String(problem.credit || 100),
      exampleInput: firstTestcaseField(problem.exampleTestcases, "input"),
      exampleOutput: firstTestcaseField(problem.exampleTestcases, "output"),
      hiddenInput: "",
      hiddenOutput: "",
    });
  };

  const handleToggleArchive = async (problem) => {
    if (!problem?._id) return;

    setError("");
    setSuccess("");
    setActionProblemId(String(problem._id));

    try {
      const endpoint = problem.isActive
        ? `${API_BASE_URL}/contest/problems/${problem._id}/archive`
        : `${API_BASE_URL}/contest/problems/${problem._id}/unarchive`;
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: buildCsrfHeaders(),
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not update problem status");
      }

      setSuccess(problem.isActive ? "Problem archived" : "Problem restored");
      await fetchProblems();
    } catch (err) {
      setError(err.message || "Could not update problem status");
    } finally {
      setActionProblemId("");
    }
  };

  const handleDeleteProblem = async (problem) => {
    if (!problem?._id) return;

    const confirmed = window.confirm(
      `Delete \"${problem.title}\" permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setError("");
    setSuccess("");
    setActionProblemId(String(problem._id));

    try {
      const res = await fetch(`${API_BASE_URL}/contest/problems/${problem._id}`, {
        method: "DELETE",
        credentials: "include",
        headers: buildCsrfHeaders(),
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not delete problem");
      }

      if (editingProblemId === String(problem._id)) {
        resetForm();
      }

      setSuccess("Problem deleted");
      await fetchProblems();
    } catch (err) {
      setError(err.message || "Could not delete problem");
    } finally {
      setActionProblemId("");
    }
  };

  if (loading || !user) return null;
  if (!isAdmin) return null;

  return (
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.12fr_0.88fr]">
        <SurfaceCard className="p-6 sm:p-7">
          <PageHeader
            eyebrow="Admin only"
            title={isEditing ? "Edit problem" : "Create problem"}
            description="Create and manage reusable contest problems."
          />

          <form className="space-y-4" onSubmit={handleCreateOrUpdateProblem}>
            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Title</span>
              <input
                type="text"
                className="input"
                value={form.title}
                onChange={(event) => handleChange("title", event.target.value)}
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Description</span>
              <textarea
                className="input min-h-28"
                value={form.description}
                onChange={(event) => handleChange("description", event.target.value)}
                required
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Difficulty</span>
                <select
                  className="input"
                  value={form.difficulty}
                  onChange={(event) => handleChange("difficulty", event.target.value)}
                >
                  {difficultyOptions.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {difficulty}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Tags (comma separated)</span>
                <input
                  type="text"
                  className="input"
                  value={form.tags}
                  onChange={(event) => handleChange("tags", event.target.value)}
                  placeholder="array, hashing"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Input format</span>
                <textarea
                  className="input min-h-24"
                  value={form.inputFormat}
                  onChange={(event) => handleChange("inputFormat", event.target.value)}
                />
              </label>

              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Output format</span>
                <textarea
                  className="input min-h-24"
                  value={form.outputFormat}
                  onChange={(event) => handleChange("outputFormat", event.target.value)}
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="mb-2 block text-[var(--text-muted)]">Constraints</span>
              <textarea
                className="input min-h-20"
                value={form.constraints}
                onChange={(event) => handleChange("constraints", event.target.value)}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Credit</span>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.credit}
                  onChange={(event) => handleChange("credit", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Time limit (ms)</span>
                <input
                  type="number"
                  min="100"
                  className="input"
                  value={form.timeLimit}
                  onChange={(event) => handleChange("timeLimit", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Memory limit (MB)</span>
                <input
                  type="number"
                  min="16"
                  className="input"
                  value={form.memoryLimit}
                  onChange={(event) => handleChange("memoryLimit", event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Example input</span>
                <textarea
                  className="input min-h-24"
                  value={form.exampleInput}
                  onChange={(event) => handleChange("exampleInput", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Example output</span>
                <textarea
                  className="input min-h-24"
                  value={form.exampleOutput}
                  onChange={(event) => handleChange("exampleOutput", event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">
                  Hidden input {isEditing ? "(optional replace)" : ""}
                </span>
                <textarea
                  className="input min-h-24"
                  value={form.hiddenInput}
                  onChange={(event) => handleChange("hiddenInput", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">
                  Hidden output {isEditing ? "(optional replace)" : ""}
                </span>
                <textarea
                  className="input min-h-24"
                  value={form.hiddenOutput}
                  onChange={(event) => handleChange("hiddenOutput", event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary w-full cursor-pointer py-3"
              >
                {submitLabel}
              </button>

              {isEditing ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-secondary w-full cursor-pointer py-3"
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>

          <StatusMessage variant="ok" role="status" className="mt-3">
            {success}
          </StatusMessage>
          <StatusMessage variant="error" role="alert" className="mt-3">
            {error}
          </StatusMessage>
        </SurfaceCard>

        <SurfaceCard className="p-6 sm:p-7">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Problem inventory</h2>
            <button
              type="button"
              onClick={() => void fetchProblems()}
              className="btn btn-secondary cursor-pointer px-3 py-2 text-xs"
            >
              Refresh
            </button>
          </div>
          <p className="body-muted mt-2 text-sm">
            Active and archived problems used across rooms.
          </p>

          {loadingProblems ? (
            <p className="status status-info mt-4">Loading problems...</p>
          ) : problems.length === 0 ? (
            <p className="status status-info mt-4">No problems found.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {problems.map((problem) => {
                const busy = actionProblemId === String(problem._id);
                const editing = editingProblemId === String(problem._id);

                return (
                  <li
                    key={problem._id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{problem.title}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="chip">{problem.difficulty}</span>
                        <span className={problem.isActive ? "chip" : "status status-warn px-2 py-0.5"}>
                          {problem.isActive ? "Active" : "Archived"}
                        </span>
                      </div>
                    </div>

                    <p className="body-muted mt-1 text-sm">Slug: {problem.slug}</p>
                    <p className="body-muted mt-1 text-xs">
                      Hidden tests: {problem.hiddenTestcasesCount || 0}
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => handleEditProblem(problem)}
                        disabled={busy}
                        className="btn btn-secondary cursor-pointer py-2 text-sm"
                      >
                        {editing ? "Editing" : "Edit"}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleToggleArchive(problem)}
                        disabled={busy}
                        className="btn btn-secondary cursor-pointer py-2 text-sm"
                      >
                        {busy
                          ? "Saving..."
                          : problem.isActive
                            ? "Archive"
                            : "Restore"}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeleteProblem(problem)}
                        disabled={busy}
                        className="btn btn-danger cursor-pointer py-2 text-sm"
                      >
                        Delete
                      </button>
                    </div>
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

export default ProblemsPage;
