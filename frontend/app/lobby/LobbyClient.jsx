"use client";
import React, { useEffect, useState } from "react";
import { useSocket } from "../utils/SocketProvider";
import { useRouter } from "next/navigation";
import { useUser } from "../utils/UserContext";

const LobbyClient = ({ roomCode }) => {
  const { socket, connected } = useSocket();
  const { user, refreshActiveRoom } = useUser();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [updatingReady, setUpdatingReady] = useState(false);
  const [startingContest, setStartingContest] = useState(false);
  const [hostUserId, setHostUserId] = useState("");
  const [allReady, setAllReady] = useState(false);
  const [contestStartAt, setContestStartAt] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const invalidRoomCode = !roomCode;
  const isHost = Boolean(user?._id && hostUserId && user._id === hostUserId);
  const isCurrentUserReady = Boolean(
    user?._id && members.find((member) => member.userId === user._id)?.ready
  );

  useEffect(() => {
    if (invalidRoomCode) return;

    if (!connected) return;

    const handleRoomMembersUpdated = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      const nextMembers = Array.isArray(payload.members) ? payload.members : [];
      setMembers(nextMembers);
      setAllReady(
        typeof payload.allReady === "boolean"
          ? payload.allReady
          : nextMembers.length > 0 &&
              nextMembers.every((member) => member.ready === true)
      );
    };

    const handleRoomClosed = async (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      await refreshActiveRoom();
      router.push("/dashboard");
    };

    const handleContestStarting = (payload = {}) => {
      if (payload.roomCode !== roomCode) return;
      if (typeof payload.contestStartAt !== "number") return;
      setError("");
      setContestStartAt(payload.contestStartAt);
    };

    socket.on("room-members-updated", handleRoomMembersUpdated);
    socket.on("room-closed", handleRoomClosed);
    socket.on("contest-starting", handleContestStarting);

    socket.emit("join-room", { roomCode }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.message || "Could not join room");
        setMembers([]);
        return;
      }

      setError("");
      const nextMembers = Array.isArray(ack?.data?.members)
        ? ack.data.members
        : [];
      setMembers(nextMembers);
      setHostUserId(
        typeof ack?.data?.hostUserId === "string" ? ack.data.hostUserId : ""
      );
      setAllReady(
        typeof ack?.data?.allReady === "boolean"
          ? ack.data.allReady
          : nextMembers.length > 0 &&
              nextMembers.every((member) => member.ready === true)
      );
      setContestStartAt(
        typeof ack?.data?.contestStartAt === "number"
          ? ack.data.contestStartAt
          : null
      );
    });

    return () => {
      socket.off("room-members-updated", handleRoomMembersUpdated);
      socket.off("room-closed", handleRoomClosed);
      socket.off("contest-starting", handleContestStarting);
    };
  }, [socket, connected, roomCode, invalidRoomCode, router, refreshActiveRoom]);

  useEffect(() => {
    if (!contestStartAt) return;

    const tick = () => {
      const msRemaining = contestStartAt - Date.now();
      if (msRemaining <= 0) {
        setContestStartAt(null);
        setCountdown(0);
        router.push(`/arena?room=${roomCode}`);
        return;
      }

      setCountdown(Math.ceil(msRemaining / 1000));
    };

    tick();
    const intervalId = setInterval(tick, 150);
    return () => clearInterval(intervalId);
  }, [contestStartAt, router, roomCode]);

  const handleLeaveLobby = () => {
    if (!connected) {
      router.push("/dashboard");
      return;
    }

    setLeaving(true);
    socket.emit("leave-room", { roomCode }, async (ack) => {
      setLeaving(false);
      if (!ack?.ok && ack?.code !== "NOT_FOUND") {
        setError(ack?.message || "Could not leave lobby");
        return;
      }

      await refreshActiveRoom();
      router.push("/dashboard");
    });
  };

  const handleToggleReady = () => {
    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    setUpdatingReady(true);
    socket.emit(
      "set-ready",
      { roomCode, ready: !isCurrentUserReady },
      (ack) => {
        setUpdatingReady(false);
        if (!ack?.ok) {
          setError(ack?.message || "Could not update ready state");
          return;
        }

        const nextMembers = Array.isArray(ack?.data?.members)
          ? ack.data.members
          : [];
        setError("");
        setMembers(nextMembers);
        setAllReady(
          typeof ack?.data?.allReady === "boolean"
            ? ack.data.allReady
            : nextMembers.length > 0 &&
                nextMembers.every((member) => member.ready === true)
        );
      }
    );
  };

  const handleStartContest = () => {
    if (!isHost) return;

    if (!connected) {
      setError("Connecting to live server. Please wait a moment and retry.");
      return;
    }

    if (!allReady) {
      setError("All members must be ready");
      return;
    }

    setStartingContest(true);
    socket.emit("start-contest", { roomCode }, (ack) => {
      setStartingContest(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not start contest");
        return;
      }

      setError("");
      if (typeof ack?.data?.contestStartAt === "number") {
        setContestStartAt(ack.data.contestStartAt);
      }
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
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl">
        <h2 className="text-2xl font-semibold mb-2 text-center">Lobby</h2>
        <p className="text-center mb-6">
          Room Code: <span className="font-bold">{roomCode || "N/A"}</span>
        </p>

        {!connected && (
          <p className="text-xs text-yellow-300 mb-4" role="status" aria-live="polite">
            Reconnecting to live server...
          </p>
        )}

        <h3 className="text-lg font-medium mb-3">Members</h3>
        {invalidRoomCode ? (
          <p className="text-red-400 text-sm">Invalid room code</p>
        ) : error ? (
          <p className="text-red-400 text-sm" role="alert">
            {error}
          </p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-300">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              <li
                key={member.userId}
                className="rounded-lg border border-white/10 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{member.username}</span>
                  <span
                    className={
                      member.ready
                        ? "text-green-400 text-xs"
                        : "text-yellow-300 text-xs"
                    }
                  >
                    {member.ready ? "Ready" : "Not Ready"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={handleToggleReady}
          disabled={updatingReady || Boolean(contestStartAt)}
          className="w-full mt-6 py-3 rounded-lg bg-blue-500 hover:bg-blue-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {updatingReady
            ? "Updating..."
            : isCurrentUserReady
              ? "Unready"
              : "Ready"}
        </button>

        {isHost ? (
          <div className="mt-3 space-y-3">
            <button
              onClick={handleStartContest}
              disabled={!allReady || startingContest || Boolean(contestStartAt)}
              className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-700 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {startingContest ? "Starting..." : "Start Contest"}
            </button>

            <button
              onClick={handleCloseRoom}
              disabled={closing}
              className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-700 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {closing ? "Closing..." : "Close Room"}
            </button>

            <button
              onClick={handleLeaveLobby}
              disabled={leaving}
              className="w-full py-3 rounded-lg bg-red-500 hover:bg-red-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {leaving ? "Leaving..." : "Leave Lobby"}
            </button>
          </div>
        ) : (
          <button
            onClick={handleLeaveLobby}
            disabled={leaving}
            className="w-full mt-3 py-3 rounded-lg bg-red-500 hover:bg-red-600 transition-all duration-200 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {leaving ? "Leaving..." : "Leave Lobby"}
          </button>
        )}
      </div>

      {contestStartAt && (countdown === null || countdown > 0) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="text-center">
            <p className="text-sm text-gray-300 mb-2">Contest starts in</p>
            <p className="text-6xl font-bold text-white">{countdown ?? 3}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LobbyClient;
