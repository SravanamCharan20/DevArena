"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Signup() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const router = useRouter();

  const handleSignup = async () => {
    setError("");
    setSuccess("");

    try {
      const res = await fetch("http://localhost:8888/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signup failed");

      setSuccess("Welcome to the Arena ⚔️");
      router.push("/auth/signin");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center text-white">
      <div className="w-[420px] border border-neutral-800 rounded-xl bg-black/70 backdrop-blur-md p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-green-400 text-5xl mb-3">&lt;/&gt;</h1>
          <h1 className="text-3xl font-semibold tracking-wide flex justify-center items-center gap-2">
            Register to level up
          </h1>
          <p className="text-neutral-400 mt-3 text-sm">
            Create Account. Enter the Arena.
          </p>
          <p className="text-neutral-500 text-xs mt-1">
            Skill speaks louder than words.
          </p>
        </div>

        {/* Inputs */}
        <div className="flex flex-col gap-3 mb-5">
          <input
            type="text"
            placeholder="Username"
            className="bg-neutral-900 border border-neutral-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            onChange={(e) => setUsername(e.target.value)}
          />

          <input
            type="email"
            placeholder="Email"
            className="bg-neutral-900 border border-neutral-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            className="bg-neutral-900 border border-neutral-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {/* Primary CTA */}
        <button
          onClick={handleSignup}
          className="w-full bg-green-500 cursor-pointer hover:bg-green-400 text-black font-medium py-3 rounded-md transition mb-3"
        >
          Spawn Account
        </button>

        {/* Status */}
        {success && (
          <p className="text-green-400 text-center text-xs mt-4">{success}</p>
        )}

        {error && (
          <p className="text-red-400 text-center text-xs mt-4">{error}</p>
        )}

        {/* Footer */}
        <p className="text-neutral-500 text-xs text-center mt-6">
          Your are not new?{" "}
          <Link className="text-green-500 hover:underline" href="/auth/signin">
            Signin here
          </Link>
        </p>
      </div>
    </div>
  );
}
