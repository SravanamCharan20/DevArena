import React from "react";
import LobbyClient from "./LobbyClient";

const LobbyPage = async ({ searchParams }) => {
  const params = await searchParams;
  const roomCode =
    typeof params?.room === "string" ? params.room.trim().toUpperCase() : "";

  return <LobbyClient roomCode={roomCode} />;
};

export default LobbyPage;
