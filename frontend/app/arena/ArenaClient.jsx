"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import StatusMessage from "../components/ui/StatusMessage";
import { useSocket } from "../utils/SocketProvider";
import { useUser } from "../utils/UserContext";

const ArenaClient = ({ roomCode }) => {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const { user, refreshActiveRoom } = useUser();
  const invalidRoomCode = !roomCode;

  const [hostUserId, setHostUserId] = useState("");
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);

  const isHost = Boolean(user?._id && hostUserId && user._id === hostUserId);

  useEffect(() => {
    if (invalidRoomCode || !connected) return;

    const handleRoomClosed = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      router.push("/dashboard");
    };

    socket.on("room-closed", handleRoomClosed);

    socket.emit("join-room", { roomCode }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not enter arena");
        return;
      }

      if (ack?.data?.status !== "running") {
        setError("Contest has not started yet");
        router.push(`/lobby?room=${roomCode}`);
        return;
      }

      setError("");
      setHostUserId(
        typeof ack?.data?.hostUserId === "string" ? ack.data.hostUserId : ""
      );
    });

    return () => {
      socket.off("room-closed", handleRoomClosed);
    };
  }, [connected, invalidRoomCode, refreshActiveRoom, roomCode, router, socket]);

  const handleLeaveArena = () => {
    if (invalidRoomCode) {
      router.push("/dashboard");
      return;
    }

    if (!connected) {
      router.push("/dashboard");
      return;
    }

    setLeaving(true);
    socket.emit("leave-room", { roomCode }, async (ack) => {
      setLeaving(false);
      if (!ack?.ok && ack?.code !== "NOT_FOUND") {
        setError(ack?.message || "Could not leave arena");
        return;
      }

      await refreshActiveRoom();
      router.push("/dashboard");
    });
  };

  const handleCloseRoom = () => {
    if (!isHost) return;
    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    setClosing(true);
    socket.emit("close-room", { roomCode }, async (ack) => {
      setClosing(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not close room");
        return;
      }

      await refreshActiveRoom();
      router.push("/dashboard");
    });
  };

  return (
    <div className="page-wrap">
      <div className="content-grid">
        <SurfaceCard className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="chip">Contest running</p>
              <h1 className="section-title mt-3">Arena</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="chip">Room {roomCode || "N/A"}</span>
              <span className="chip">{isHost ? "Host" : "Member"}</span>
            </div>
          </div>

          {!connected ? (
            <StatusMessage variant="warn" role="status" className="mt-4">
              Reconnecting to live server...
            </StatusMessage>
          ) : null}

          <StatusMessage variant="error" role="alert" className="mt-3">
            {error}
          </StatusMessage>
        </SurfaceCard>

        <div className="content-grid lg:grid-cols-[1.2fr_0.8fr]">
          <SurfaceCard className="min-h-[360px] p-6 sm:p-7">
            <h2 className="text-lg font-semibold">Contest workspace</h2>
            <p className="body-muted mt-2 text-sm sm:text-base">
              This area is reserved for problem statement, code editor, and submissions.
            </p>

            <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-6 text-sm text-[var(--text-muted)]">
              Workspace placeholder is ready for your coding integration.
            </div>
          </SurfaceCard>

          <SurfaceCard className="h-fit p-6 sm:p-7">
            <h3 className="text-lg font-semibold">Room controls</h3>
            <p className="body-muted mt-2 text-sm">Leave safely or close room if you are host.</p>

            <div className="mt-5 space-y-3">
              <button
                onClick={handleLeaveArena}
                disabled={leaving}
                className="btn btn-danger w-full cursor-pointer py-3"
              >
                {leaving ? "Leaving..." : "Leave Arena"}
              </button>

              {isHost ? (
                <button
                  onClick={handleCloseRoom}
                  disabled={closing}
                  className="btn btn-secondary w-full cursor-pointer py-3"
                >
                  {closing ? "Closing..." : "Close Room"}
                </button>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-muted)]">
                  Only host can close room.
                </div>
              )}
            </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};

export default ArenaClient;
