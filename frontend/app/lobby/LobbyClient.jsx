"use client";
import React, { useEffect, useState } from "react";
import { useSocket } from "../utils/SocketProvider";
import { useRouter } from "next/navigation";

const LobbyClient = ({ roomCode }) => {
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const invalidRoomCode = !roomCode;

  useEffect(() => {
    if (invalidRoomCode) return;

    if (!connected) return;

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    };

    socket.on("room-members-updated", handleRoomMembersUpdated);

    socket.emit("join-room", { roomCode }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not join room");
        setMembers([]);
        return;
      }

      setError("");
      setMembers(Array.isArray(ack?.data?.members) ? ack.data.members : []);
    });

    return () => {
      socket.off("room-members-updated", handleRoomMembersUpdated);
    };
  }, [socket, connected, roomCode, invalidRoomCode]);

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

        <button
          onClick={handleLeaveLobby}
          disabled={leaving}
          className="w-full mt-6 py-3 rounded-lg bg-red-500 hover:bg-red-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {leaving ? "Leaving..." : "Leave Lobby"}
        </button>
      </div>
    </div>
  );
};

export default LobbyClient;
