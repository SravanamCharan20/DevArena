"use client";
import React, { useState } from "react";
import { useSocket } from "../../utils/SocketProvider";
import { useRouter } from "next/navigation";

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
    socket.emit(
      "join-room",
      { roomCode: normalizedRoomCode },
      (ack) => {
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
      }
    );
  };

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl">
        <h2 className="text-2xl font-semibold text-center mb-6">Join Room</h2>

        {!connected && (
          <p className="text-xs text-yellow-300 mb-3" role="status" aria-live="polite">
            Reconnecting to live server...
          </p>
        )}

        <label className="block mb-2">Enter Room Code</label>
        <input
          type="text"
          placeholder="e.g. A1B2C3D4"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          className="w-full border p-3 rounded-lg border-green-600 mb-4"
        />

        <button
          onClick={handleJoinRoom}
          disabled={joining}
          className="w-full bg-green-600 border p-3 rounded-lg text-black cursor-pointer"
        >
          {joining ? "Joining..." : "Join"}
        </button>

        {error && (
          <p className="text-red-400 mt-3 text-sm" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default JoinRoomPage;
