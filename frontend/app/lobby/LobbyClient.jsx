"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SurfaceCard from "../components/ui/SurfaceCard";
import PageHeader from "../components/ui/PageHeader";
import StatusMessage from "../components/ui/StatusMessage";
import { useSocket } from "../utils/SocketProvider";
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
      const nextMembers = Array.isArray(ack?.data?.members) ? ack.data.members : [];
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
        typeof ack?.data?.contestStartAt === "number" ? ack.data.contestStartAt : null
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
    socket.emit("set-ready", { roomCode, ready: !isCurrentUserReady }, (ack) => {
      setUpdatingReady(false);
      if (!ack?.ok) {
        setError(ack?.message || "Could not update ready state");
        return;
      }

      const nextMembers = Array.isArray(ack?.data?.members) ? ack.data.members : [];
      setError("");
      setMembers(nextMembers);
      setAllReady(
        typeof ack?.data?.allReady === "boolean"
          ? ack.data.allReady
          : nextMembers.length > 0 &&
              nextMembers.every((member) => member.ready === true)
      );
    });
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
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.18fr_0.82fr]">
        <SurfaceCard className="p-6 sm:p-7">
          <PageHeader
            eyebrow="Lobby"
            title="Member readiness"
            description="Everyone in the room should be ready before contest starts."
            aside={<span className="chip">Room {roomCode || "N/A"}</span>}
          />

          {!connected ? (
            <StatusMessage variant="warn" role="status" className="mb-4">
              Reconnecting to live server...
            </StatusMessage>
          ) : null}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Members</h3>
              <span className="chip">{members.length} joined</span>
            </div>

            {invalidRoomCode ? (
              <StatusMessage variant="error">Invalid room code</StatusMessage>
            ) : error ? (
              <StatusMessage variant="error" role="alert">
                {error}
              </StatusMessage>
            ) : members.length === 0 ? (
              <StatusMessage variant="info">No members yet.</StatusMessage>
            ) : (
              <ul className="space-y-2.5">
                {members.map((member) => {
                  const memberIsHost = member.userId === hostUserId;
                  return (
                    <li
                      key={member.userId}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 text-sm sm:text-base">
                        <span>{member.username}</span>
                        {memberIsHost ? <span className="chip">Host</span> : null}
                      </div>
                      <span className={member.ready ? "status-ok text-xs" : "status-warn text-xs"}>
                        {member.ready ? "Ready" : "Not ready"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard className="h-fit p-6 sm:p-7 lg:sticky lg:top-24">
          <h3 className="text-lg font-semibold">Controls</h3>
          <p className="body-muted mt-2 text-sm">
            Toggle your readiness and start contest when all users are ready.
          </p>

          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm">
            Team state:{" "}
            <span className={allReady ? "status-ok font-medium" : "status-warn font-medium"}>
              {allReady ? "All ready" : "Waiting"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <button
              onClick={handleToggleReady}
              disabled={updatingReady || Boolean(contestStartAt)}
              className="btn btn-primary w-full cursor-pointer py-3"
            >
              {updatingReady
                ? "Updating..."
                : isCurrentUserReady
                  ? "Mark Unready"
                  : "Mark Ready"}
            </button>

            {isHost ? (
              <button
                onClick={handleStartContest}
                disabled={!allReady || startingContest || Boolean(contestStartAt)}
                className="btn btn-secondary w-full cursor-pointer py-3"
              >
                {startingContest ? "Starting..." : "Start Contest"}
              </button>
            ) : null}

            <button
              onClick={handleLeaveLobby}
              disabled={leaving}
              className="btn btn-danger w-full cursor-pointer py-3"
            >
              {leaving ? "Leaving..." : "Leave Lobby"}
            </button>

            {isHost ? (
              <button
                onClick={handleCloseRoom}
                disabled={closing}
                className="btn btn-danger w-full cursor-pointer py-3"
              >
                {closing ? "Closing..." : "Close Room"}
              </button>
            ) : null}
          </div>
        </SurfaceCard>
      </div>

      {contestStartAt && (countdown === null || countdown > 0) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/62 backdrop-blur-sm">
          <div className="panel px-12 py-10 text-center">
            <p className="body-muted mb-2 text-sm">Contest starts in</p>
            <p className="display-title">{countdown ?? 3}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LobbyClient;
