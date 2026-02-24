"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SurfaceCard from "../../components/ui/SurfaceCard";
import StatusMessage from "../../components/ui/StatusMessage";
import { API_BASE_URL } from "../../utils/config";

export default function Signup() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleSignup = async () => {
    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signup failed");

      setSuccess("Account created. Redirecting...");
      router.push("/auth/signin");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-wrap">
      <SurfaceCard className="mx-auto max-w-lg p-8 sm:p-10">
        <p className="chip">New account</p>
        <h1 className="section-title mt-4">Create your DevArena profile</h1>
        <p className="body-muted mt-2 text-sm sm:text-base">
          Register once and participate in real-time coding rooms.
        </p>

        <div className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-2 block text-[var(--text-muted)]">Username</span>
            <input
              type="text"
              placeholder="charan"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-2 block text-[var(--text-muted)]">Email</span>
            <input
              type="email"
              placeholder="you@example.com"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-2 block text-[var(--text-muted)]">Password</span>
            <input
              type="password"
              placeholder="At least 6 characters"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <button
          onClick={handleSignup}
          disabled={submitting || !username || !email || !password}
          className="btn btn-primary mt-6 w-full cursor-pointer py-3"
        >
          {submitting ? "Creating..." : "Create Account"}
        </button>

        <StatusMessage variant="ok" role="status" className="mt-3">
          {success}
        </StatusMessage>
        <StatusMessage variant="error" role="alert" className="mt-3">
          {error}
        </StatusMessage>

        <p className="body-muted mt-6 text-sm">
          Already registered?{" "}
          <Link className="font-medium text-[var(--accent)] hover:underline" href="/auth/signin">
            Sign in
          </Link>
        </p>
      </SurfaceCard>
    </div>
  );
}
