"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../../components/ui/SurfaceCard";
import PageHeader from "../../components/ui/PageHeader";
import StatusMessage from "../../components/ui/StatusMessage";
import { useSocket } from "../../utils/SocketProvider";

const JoinRoomPage = () => {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const router = useRouter();
  const { socket, connected } = useSocket();

  const handleJoinRoom = () => {
    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    const normalizedRoomCode = roomCode.trim().toUpperCase();
    if (!normalizedRoomCode) {
      setError("Room code is required");
      return;
    }

    setError("");
    setJoining(true);
    socket.emit("join-room", { roomCode: normalizedRoomCode }, (ack) => {
      setJoining(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not join room");
        return;
      }

      const nextRoomCode = ack?.data?.roomCode;
      if (!nextRoomCode) {
        setError("Could not join room");
        return;
      }

      router.push(`/lobby?room=${nextRoomCode}`);
    });
  };

  return (
    <div className="page-wrap">
      <SurfaceCard className="mx-auto max-w-2xl p-7 sm:p-9">
        <PageHeader
          eyebrow="Member access"
          title="Join with room code"
          description="Paste the shared code to enter that lobby."
        />

        {!connected ? (
          <StatusMessage variant="warn" role="status" className="mb-3">
            Reconnecting to live server...
          </StatusMessage>
        ) : null}

        <label className="block text-sm">
          <span className="mb-2 block text-[var(--text-muted)]">Room Code</span>
          <input
            type="text"
            placeholder="A1B2C3D4"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            className="input tracking-[0.15em]"
          />
        </label>

        <button
          onClick={handleJoinRoom}
          disabled={joining}
          className="btn btn-primary mt-5 w-full cursor-pointer py-3"
        >
          {joining ? "Joining..." : "Join Room"}
        </button>

        <StatusMessage variant="error" role="alert" className="mt-3">
          {error}
        </StatusMessage>
      </SurfaceCard>
    </div>
  );
};

export default JoinRoomPage;
