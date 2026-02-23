"use client";
import React from "react";
import { useUser } from "../utils/UserContext";

const Dashboard = () => {
  const { user } = useUser();
  if (!user) return;

  const isAdmin = user.role === "admin";
  return (
    <div>
      {isAdmin && <button>Create Room</button>}

      <button>Join Room</button>
    </div>
  );
};

export default Dashboard;
