"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useUser } from "../utils/UserContext";
import ThemeToggle from "./ThemeToggle";
import { API_BASE_URL } from "../utils/config";
import { buildCsrfHeaders } from "../utils/csrf";

const Navbar = () => {
  const { user, setUser, loading } = useUser();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: buildCsrfHeaders(),
      });

      setUser(null);
      router.push("/auth/signin");
    } catch {
      console.error("Logout failed");
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)]/50 bg-[color-mix(in_srgb,var(--bg),transparent_14%)] backdrop-blur-xl">
      <div className="page-wrap !py-3">
        {loading ? (
          <div className="panel h-12 skeleton" />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-[0.16em] text-[var(--text-soft)]">
                DEVARENA
              </span>
            </Link>

            <div className="flex items-center gap-2">
              {user ? (
                <Link href="/dashboard" className="btn btn-secondary h-9 px-3 text-sm">
                  Dashboard
                </Link>
              ) : null}

              {user?.role === "admin" ? (
                <Link href="/problems" className="btn btn-secondary h-9 px-3 text-sm">
                  Problems
                </Link>
              ) : null}

              <ThemeToggle />

              {!user ? (
                <>
                  <Link href="/auth/signin" className="btn btn-secondary h-9 px-3 text-sm">
                    Sign In
                  </Link>
                  <Link href="/auth/signup" className="btn btn-primary h-9 px-3 text-sm">
                    Get Started
                  </Link>
                </>
              ) : (
                <>
                  <div className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-sm md:block">
                    {user.username}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="btn btn-danger h-9 px-3 text-sm cursor-pointer"
                  >
                    <LogOut size={14} />
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
