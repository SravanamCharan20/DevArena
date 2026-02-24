"use client";
import React, { useEffect } from "react";
import { useUser } from "../utils/UserContext";
import socket from "../utils/socket";
import Link from "next/link";
import { useRouter } from "next/navigation";

const Dashboard = () => {
  const { user } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      console.log(socket.id);
    };

    socket.on("connect", onConnect);

    return () => {
      socket.off("connect", onConnect);
    };
  }, [user]);

  const handleCreateRoom = () => {
    socket.emit("create-room",{createdBy : user.username},(ack) => {
      if (!socket.connected) {
        console.log("Socket not connected yet");
        return;
      }
      if(!ack?.ok){
        return;
      }

      console.log("room members" ,ack.members); 
      router.push(`/rooms/createRoom?room=${ack.roomCode}`);
    });
  };

  if (!user) return null;

  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-sm shadow-xl rounded-2xl p-8">
        <h2 className="text-2xl font-semibold text-green-400/70 text-center mb-6">
          Welcome
        </h2>

        <div className="flex flex-col gap-4">
          {isAdmin && (
            <Link href="/rooms/createRoom">
              <button
                onClick={() => handleCreateRoom()}
                className="w-full py-3 rounded-xl cursor-pointer bg-green-400/70 hover:bg-green-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]"
              >
                Create Room
              </button>
            </Link>
          )}

          <button className="w-full py-3 rounded-xl bg-indigo-500/70 hover:bg-indigo-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]">
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
