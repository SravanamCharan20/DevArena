"use client";
import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "../utils/UserContext";
import { useSocket } from "../utils/SocketProvider";
import { API_BASE_URL } from "../utils/config";

const Navbar = () => {
  const { user, setUser, loading, activeRoom, refreshActiveRoom } = useUser();
  const { socket, connected } = useSocket();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      if (activeRoom?.roomCode && connected) {
        await new Promise((resolve) => {
          socket.emit("leave-room", { roomCode: activeRoom.roomCode }, () => {
            resolve();
          });
        });
      }

      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      await refreshActiveRoom();
      setUser(null);
      router.push("/auth/signin");
    } catch {
      console.error("Logout failed");
    }
  };

  // 🟡 Smooth skeleton while auth loads
  if (loading) {
    return (
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-3xl">
        <div className="h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/10 animate-pulse" />
      </nav>
    );
  }

  return (
    <nav
      className="
        fixed top-6 left-1/2 -translate-x-1/2
        z-50
        w-[90%] max-w-3xl
        backdrop-blur-md bg-black/60
        rounded-full
        shadow-lg shadow-black/30
        border border-white/10
      "
    >
      <div className="px-6 py-3 flex items-center justify-between text-white">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <span className="text-xl transition group-hover:scale-110">⚔️</span>
          <span className="text-lg font-semibold tracking-wide">
            Code<span className="text-green-400">Clash</span>
          </span>
        </Link>

        <Link
          href="/dashboard"
          className="text-sm text-gray-300 hover:text-white transition"
        >
          Dashboard
        </Link>

        {/* Right Section */}
        {!user ? (
          <div className="flex items-center gap-4">
            <Link
              href="/auth/signin"
              className="text-sm text-gray-300 hover:text-white transition"
            >
              Sign In
            </Link>

            <Link
              href="/auth/signup"
              className="text-sm px-4 py-1.5 rounded-full
                         bg-green-500 hover:bg-green-600
                         transition shadow-md"
            >
              Sign Up
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-300">
              Hi,{" "}
              <span className="text-white font-medium">{user.username}</span>
            </span>

            <button
              onClick={handleLogout}
              className="text-sm px-4 py-1.5 rounded-full
                         bg-red-500 hover:bg-red-600
                         transition cursor-pointer"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
