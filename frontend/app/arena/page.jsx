import React from "react";
import ArenaClient from "./ArenaClient";

const ArenaPage = async ({ searchParams }) => {
  const params = await searchParams;
  const roomCode =
    typeof params?.room === "string" ? params.room.trim().toUpperCase() : "";

  return <ArenaClient roomCode={roomCode} />;
};

export default ArenaPage;
