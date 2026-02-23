"use client";
import React, { useEffect } from "react";
import { useUser } from "../utils/UserContext";
import socket from "../utils/socket";

const Dashboard = () => {
  const { user } = useUser();

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

  if (!user) return null;

  const isAdmin = user.role === "admin";

  return (
    <div>
      {isAdmin && <button>Create Room</button>}
      <button>Join Room</button>
    </div>
  );
};

export default Dashboard;