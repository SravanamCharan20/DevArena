"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SurfaceCard from "../../components/ui/SurfaceCard";
import StatusMessage from "../../components/ui/StatusMessage";
import { useUser } from "../../utils/UserContext";
import { API_BASE_URL } from "../../utils/config";

export default function Signin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { setUser, refreshActiveRoom } = useUser();
  const router = useRouter();

  const handleSignin = async () => {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/signin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signin failed");

      setUser(data.user);
      await refreshActiveRoom();
      setSuccess("Signed in successfully");
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-wrap">
      <SurfaceCard className="mx-auto max-w-lg p-8 sm:p-10">
        <p className="chip">Welcome back</p>
        <h1 className="section-title mt-4">Sign in to DevArena</h1>
        <p className="body-muted mt-2 text-sm sm:text-base">
          Continue your rooms and ongoing contests from where you left off.
        </p>

        <div className="mt-6 space-y-4">
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
              placeholder="Enter your password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <button
          onClick={handleSignin}
          disabled={submitting || !email || !password}
          className="btn btn-primary mt-6 w-full cursor-pointer py-3"
        >
          {submitting ? "Signing in..." : "Sign In"}
        </button>

        <StatusMessage variant="ok" role="status" className="mt-3">
          {success}
        </StatusMessage>
        <StatusMessage variant="error" role="alert" className="mt-3">
          {error}
        </StatusMessage>

        <p className="body-muted mt-6 text-sm">
          New to DevArena?{" "}
          <Link className="font-medium text-[var(--accent)] hover:underline" href="/auth/signup">
            Create account
          </Link>
        </p>
      </SurfaceCard>
    </div>
  );
}
