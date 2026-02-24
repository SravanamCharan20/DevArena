"use client";
import React, { useState } from "react";
import { useSocket } from "../../utils/SocketProvider";
import { useRouter } from "next/navigation";

const JoinRoomPage = () => {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const { socket, connected } = useSocket();

  const handleJoinRoom = () => {
    if (!connected) {
      setError("Socket not connected yet");
      return;
    }

    setError("");
    socket.emit(
      "join-room",
      { roomCode },
      (ack) => {
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
          className="w-full bg-green-600 border p-3 rounded-lg text-black cursor-pointer"
        >
          Join
        </button>

        {error && <p className="text-red-400 mt-3 text-sm">{error}</p>}
      </div>
    </div>
  );
};

export default JoinRoomPage;
