"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl text-center">
        <h2 className="text-2xl font-semibold mb-3">Arena</h2>
        <p>
          Room Code: <span className="font-bold">{roomCode || "N/A"}</span>
        </p>

        {!connected && (
          <p className="text-xs text-yellow-300 mt-3" role="status" aria-live="polite">
            Reconnecting to live server...
          </p>
        )}

        {error && (
          <p className="text-red-400 text-sm mt-4" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={handleLeaveArena}
          disabled={leaving}
          className="w-full mt-6 py-3 rounded-lg bg-red-500 hover:bg-red-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {leaving ? "Leaving..." : "Leave Arena"}
        </button>

        {isHost && (
          <button
            onClick={handleCloseRoom}
            disabled={closing}
            className="w-full mt-3 py-3 rounded-lg bg-red-700 hover:bg-red-800 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {closing ? "Closing..." : "Close Room"}
          </button>
        )}
      </div>
    </div>
  );
};

export default ArenaClient;
