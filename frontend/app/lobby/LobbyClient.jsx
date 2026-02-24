"use client";
import React, { useEffect, useState } from "react";
import { useSocket } from "../utils/SocketProvider";
import { useRouter } from "next/navigation";
import { useUser } from "../utils/UserContext";

const LobbyClient = ({ roomCode }) => {
  const { socket, connected } = useSocket();
  const { user } = useUser();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [hostUserId, setHostUserId] = useState("");
  const invalidRoomCode = !roomCode;
  const isHost = Boolean(user?._id && hostUserId && user._id === hostUserId);

  useEffect(() => {
    if (invalidRoomCode) return;

    if (!connected) return;

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    };

    const handleRoomClosed = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      router.push("/dashboard");
    };

    socket.on("room-members-updated", handleRoomMembersUpdated);
    socket.on("room-closed", handleRoomClosed);

    socket.emit("join-room", { roomCode }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not join room");
        setMembers([]);
        return;
      }

      setError("");
      setMembers(Array.isArray(ack?.data?.members) ? ack.data.members : []);
      setHostUserId(typeof ack?.data?.hostUserId === "string" ? ack.data.hostUserId : "");
    });

    return () => {
      socket.off("room-members-updated", handleRoomMembersUpdated);
      socket.off("room-closed", handleRoomClosed);
    };
  }, [socket, connected, roomCode, invalidRoomCode, router]);

  const handleLeaveLobby = () => {
    if (!connected) {
      router.push("/dashboard");
      return;
    }

    setLeaving(true);
    socket.emit("leave-room", { roomCode }, (ack) => {
      setLeaving(false);
      if (!ack?.ok && ack?.code !== "NOT_FOUND") {
        setError(ack?.message || "Could not leave lobby");
        return;
      }

      router.push("/dashboard");
    });
  };

  const handleCloseRoom = () => {
    if (!isHost) return;

    if (!connected) {
      setError("Socket not connected yet");
      return;
    }

    setClosing(true);
    socket.emit("close-room", { roomCode }, (ack) => {
      setClosing(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not close room");
        return;
      }

      router.push("/dashboard");
    });
  };

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl">
        <h2 className="text-2xl font-semibold mb-2 text-center">Lobby</h2>
        <p className="text-center mb-6">
          Room Code: <span className="font-bold">{roomCode || "N/A"}</span>
        </p>

        <h3 className="text-lg font-medium mb-3">Members</h3>
        {invalidRoomCode ? (
          <p className="text-red-400 text-sm">Invalid room code</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-300">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              <li
                key={member.userId}
                className="rounded-lg border border-white/10 px-3 py-2"
              >
                {member.username}
              </li>
            ))}
          </ul>
        )}

        {isHost ? (
          <button
            onClick={handleCloseRoom}
            disabled={closing}
            className="w-full mt-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {closing ? "Closing..." : "Close Room"}
          </button>
        ) : (
          <button
            onClick={handleLeaveLobby}
            disabled={leaving}
            className="w-full mt-6 py-3 rounded-lg bg-red-500 hover:bg-red-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {leaving ? "Leaving..." : "Leave Lobby"}
          </button>
        )}
      </div>
    </div>
  );
};

export default LobbyClient;
