"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../../components/ui/SurfaceCard";
import PageHeader from "../../components/ui/PageHeader";
import StatusMessage from "../../components/ui/StatusMessage";
import { useSocket } from "../../utils/SocketProvider";
import { useUser } from "../../utils/UserContext";

const CreateRoomPage = () => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { socket, connected } = useSocket();
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (userLoading || !user) return;
    if (user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [userLoading, user, router]);

  const handleSet = () => {
    if (!user || user.role !== "admin") {
      setError("Only admin can create rooms");
      return;
    }

    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    setError("");
    setLoading(true);

    socket.emit("create-room", {}, (ack) => {
      setLoading(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not create room");
        return;
      }

      const nextRoomCode = ack?.data?.roomCode;
      if (!nextRoomCode) {
        setError("Could not create room");
        return;
      }

      router.push(`/lobby?room=${nextRoomCode}`);
    });
  };

  if (userLoading || !user) return null;
  if (user.role !== "admin") return null;

  return (
    <div className="page-wrap">
      <SurfaceCard className="mx-auto max-w-2xl p-7 sm:p-9">
        <PageHeader
          eyebrow="Admin only"
          title="Create new room"
          description="Generate a room code and move directly to the lobby as host."
        />

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <p className="text-sm">After creation, you can manage readiness and start contest.</p>
        </div>

        {!connected ? (
          <StatusMessage variant="warn" role="status" className="mt-4">
            Reconnecting to live server...
          </StatusMessage>
        ) : null}

        <button
          onClick={handleSet}
          disabled={loading}
          className="btn btn-primary mt-6 w-full cursor-pointer py-3"
        >
          {loading ? "Creating..." : "Create and Enter Lobby"}
        </button>

        <StatusMessage variant="error" role="alert" className="mt-3">
          {error}
        </StatusMessage>
      </SurfaceCard>
    </div>
  );
};

export default CreateRoomPage;
