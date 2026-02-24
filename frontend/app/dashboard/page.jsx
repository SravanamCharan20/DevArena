"use client";
import React from "react";
import { useUser } from "../utils/UserContext";
import Link from "next/link";

const Dashboard = () => {
  const { user } = useUser();

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
            <Link
              href="/rooms/createRoom"
              className="w-full py-3 rounded-xl cursor-pointer bg-green-400/70 hover:bg-green-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]"
            >
              Create Room
            </Link>
          )}

          <Link
            href="/rooms/joinRoom"
            className="w-full text-center py-3 rounded-xl bg-indigo-500/70 hover:bg-indigo-600 transition-all duration-200 text-white font-medium shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            Join Room
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
