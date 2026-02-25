"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import PageHeader from "../components/ui/PageHeader";
import StatusMessage from "../components/ui/StatusMessage";
import { useUser } from "../utils/UserContext";
import { API_BASE_URL } from "../utils/config";

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
  exampleInput: "",
  exampleOutput: "",
  hiddenInput: "",
  hiddenOutput: "",
};

const ProblemsPage = () => {
  const router = useRouter();
  const { user, loading } = useUser();
  const [form, setForm] = useState(emptyProblemForm);
  const [problems, setProblems] = useState([]);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isAdmin = user?.role === "admin";

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
    fetchProblems();
  }, [loading, user, isAdmin, router]);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreateProblem = async (event) => {
    event.preventDefault();
    if (!isAdmin) return;

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const tags = form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      const exampleTestcases =
        form.exampleInput.trim() && form.exampleOutput.trim()
          ? [
              {
                input: form.exampleInput.trim(),
                output: form.exampleOutput.trim(),
              },
            ]
          : [];

      const hiddenTestcases =
        form.hiddenInput.trim() && form.hiddenOutput.trim()
          ? [
              {
                input: form.hiddenInput.trim(),
                output: form.hiddenOutput.trim(),
              },
            ]
          : [];

      const payload = {
        title: form.title,
        description: form.description,
        difficulty: form.difficulty,
        inputFormat: form.inputFormat,
        outputFormat: form.outputFormat,
        constraints: form.constraints,
        tags,
        timeLimit: Number(form.timeLimit || 1000),
        memoryLimit: Number(form.memoryLimit || 256),
        exampleTestcases,
        hiddenTestcases,
      };

      const res = await fetch(`${API_BASE_URL}/contest/problems`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Could not create problem");
      }

      setSuccess("Problem created successfully");
      setForm(emptyProblemForm);
      await fetchProblems();
    } catch (err) {
      setError(err.message || "Could not create problem");
    } finally {
      setSubmitting(false);
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
            title="Create problem"
            description="Create problems once and reuse them while creating contest rooms."
          />

          <form className="space-y-4" onSubmit={handleCreateProblem}>
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
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
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

            <div className="grid gap-4 sm:grid-cols-2">
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
                <span className="mb-2 block text-[var(--text-muted)]">Hidden input</span>
                <textarea
                  className="input min-h-24"
                  value={form.hiddenInput}
                  onChange={(event) => handleChange("hiddenInput", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[var(--text-muted)]">Hidden output</span>
                <textarea
                  className="input min-h-24"
                  value={form.hiddenOutput}
                  onChange={(event) => handleChange("hiddenOutput", event.target.value)}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary w-full cursor-pointer py-3"
            >
              {submitting ? "Creating..." : "Create Problem"}
            </button>
          </form>

          <StatusMessage variant="ok" role="status" className="mt-3">
            {success}
          </StatusMessage>
          <StatusMessage variant="error" role="alert" className="mt-3">
            {error}
          </StatusMessage>
        </SurfaceCard>

        <SurfaceCard className="p-6 sm:p-7">
          <h2 className="text-lg font-semibold">Available problems</h2>
          <p className="body-muted mt-2 text-sm">
            These problems can be selected while creating a room.
          </p>

          {loadingProblems ? (
            <p className="status status-info mt-4">Loading problems...</p>
          ) : problems.length === 0 ? (
            <p className="status status-info mt-4">No problems found.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {problems.map((problem) => (
                <li
                  key={problem._id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{problem.title}</p>
                    <span className="chip">{problem.difficulty}</span>
                  </div>
                  <p className="body-muted mt-1 text-sm">Slug: {problem.slug}</p>
                </li>
              ))}
            </ul>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default ProblemsPage;
