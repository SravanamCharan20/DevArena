"use client";
import React, { useState } from "react";
import { useUser } from "../utils/UserContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSocket } from "../utils/SocketProvider";

const Dashboard = () => {
  const { user, activeRoom, refreshActiveRoom } = useUser();
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState("");

  if (!user) return null;

  const isAdmin = user.role === "admin";
  const hasRunningContest = activeRoom?.status === "running" && activeRoom?.roomCode;
  const hasLobbyRoom = activeRoom?.status === "lobby" && activeRoom?.roomCode;

  const handleResume = () => {
    if (!activeRoom?.roomCode) return;

    if (!connected) {
      setResumeError("Socket not connected yet");
      return;
    }

    setResumeError("");
    setResumeLoading(true);

    socket.emit("join-room", { roomCode: activeRoom.roomCode }, async (ack) => {
      setResumeLoading(false);

      if (!ack?.ok) {
        setResumeError(ack?.message || "You are not allowed to enter this contest");
        await refreshActiveRoom();
        return;
      }

      if (activeRoom.status === "running") {
        router.push(`/arena?room=${activeRoom.roomCode}`);
        return;
      }

      router.push(`/lobby?room=${activeRoom.roomCode}`);
    });
  };

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-sm shadow-xl rounded-2xl p-8">
        <h2 className="text-2xl font-semibold text-green-400/70 text-center mb-6">
          Welcome
        </h2>

        <div className="flex flex-col gap-4">
          {(hasRunningContest || hasLobbyRoom) && (
            <div className="rounded-xl border border-white/20 p-4">
              <p className="text-sm text-gray-300">
                {hasRunningContest ? "Ongoing Contest" : "Active Lobby"}
              </p>
              <p className="text-sm mt-1">
                Room: <span className="font-bold">{activeRoom.roomCode}</span>
              </p>
              <button
                onClick={handleResume}
                disabled={resumeLoading}
                className="w-full mt-3 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 transition-all duration-200 text-black font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {resumeLoading
                  ? "Checking..."
                  : hasRunningContest
                    ? "Resume Contest"
                    : "Open Lobby"}
              </button>
              {resumeError && (
                <p className="text-red-400 text-xs mt-2">{resumeError}</p>
              )}
            </div>
          )}

          {isAdmin && (
            <Link
              href="/rooms/createRoom"
              className="w-full py-3 rounded-xl cursor-pointer bg-green-400/70 hover:bg-green-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]"
            >
              Create Room
            </Link>
          )}

          <Link
            href="/rooms/joinRoom"
            className="w-full text-center py-3 rounded-xl bg-indigo-500/70 hover:bg-indigo-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            Join Room
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
