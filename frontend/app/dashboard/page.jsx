"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import PageHeader from "../components/ui/PageHeader";
import StatusMessage from "../components/ui/StatusMessage";
import { useUser } from "../utils/UserContext";
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
  const hasAnyActiveRoom = Boolean(hasRunningContest || hasLobbyRoom);

  const handleResume = () => {
    if (!activeRoom?.roomCode) return;

    if (!connected) {
      setResumeError("Connecting to live server. Please wait a moment and retry.");
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

      const nextRoomCode = ack?.data?.roomCode || activeRoom.roomCode;
      const nextStatus = ack?.data?.status;
      if (nextStatus === "running") {
        router.push(`/arena?room=${nextRoomCode}`);
        return;
      }

      router.push(`/lobby?room=${nextRoomCode}`);
    });
  };

  return (
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.18fr_0.82fr]">
        <SurfaceCard className="p-6 sm:p-7">
          <PageHeader
            eyebrow={isAdmin ? "Admin dashboard" : "Participant dashboard"}
            title="Your current session"
            description="Resume active rooms quickly or start a new one."
          />

          {!connected ? (
            <StatusMessage variant="warn" role="status" className="mb-4">
              Reconnecting to live server...
            </StatusMessage>
          ) : null}

          {hasAnyActiveRoom ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
              <p className="text-sm text-[var(--text-muted)]">
                {hasRunningContest ? "Contest in progress" : "Lobby in progress"}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xl font-semibold">{activeRoom.roomCode}</p>
                <span className="chip">{hasRunningContest ? "Running" : "Lobby"}</span>
              </div>

              <button
                onClick={handleResume}
                disabled={resumeLoading}
                className="btn btn-primary mt-5 w-full cursor-pointer py-3"
              >
                {resumeLoading
                  ? "Checking..."
                  : hasRunningContest
                    ? "Resume Contest"
                    : "Open Lobby"}
              </button>

              <StatusMessage variant="error" role="alert" className="mt-3">
                {resumeError}
              </StatusMessage>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-6">
              <p className="font-medium">No active room</p>
              <p className="body-muted mt-2 text-sm">
                Choose create room or join room from the actions panel.
              </p>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="p-6 sm:p-7">
          <h2 className="text-lg font-semibold">Actions</h2>
          <p className="body-muted mt-2 text-sm">
            Use these options to enter your next coding room.
          </p>

          <div className="mt-5 space-y-3">
            {!hasAnyActiveRoom && isAdmin ? (
              <Link
                href="/rooms/createRoom"
                className="btn btn-primary flex w-full justify-center py-3"
              >
                Create Room
              </Link>
            ) : null}

            {!hasAnyActiveRoom ? (
              <Link
                href="/rooms/joinRoom"
                className="btn btn-secondary flex w-full justify-center py-3"
              >
                Join Room
              </Link>
            ) : null}
          </div>

          {hasAnyActiveRoom ? (
            <>
              <div className="soft-divider mt-5" />
              <StatusMessage variant="info" role="status" className="mt-4">
                Leave your current room before creating or joining another one.
              </StatusMessage>
            </>
          ) : null}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default Dashboard;
