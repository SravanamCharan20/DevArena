"use client";
import React, { useEffect, useState } from "react";
import { useSocket } from "../utils/SocketProvider";

const LobbyClient = ({ roomCode }) => {
  const { socket, connected } = useSocket();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const invalidRoomCode = !roomCode;

  useEffect(() => {
    if (invalidRoomCode) return;

    if (!connected) return;

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    };

    socket.on("room-members-updated", handleRoomMembersUpdated);

    socket.emit("get-room-members", { roomCode }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not load members");
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
                key={member.userId || member.socketId}
                className="rounded-lg border border-white/10 px-3 py-2"
              >
                {member.username}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default LobbyClient;
