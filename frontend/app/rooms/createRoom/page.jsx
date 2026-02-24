"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "../../utils/SocketProvider";

const CreateRoomPage = () => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { socket, connected } = useSocket();
  const router = useRouter();

  const handleSet = () => {
    if (!connected) {
      setError("Socket not connected yet");
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

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl">
        <h2 className="text-2xl font-semibold text-center mb-4">Create Room</h2>

        <button
          onClick={handleSet}
          disabled={loading}
          className="block w-full text-center py-3 rounded-xl bg-green-500 hover:bg-green-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? "Setting..." : "Set"}
        </button>

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
};

export default CreateRoomPage;
