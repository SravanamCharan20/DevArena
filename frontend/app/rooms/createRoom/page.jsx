"use client";

import { useSearchParams } from "next/navigation";
import React from "react";

const createRoom = () => {
  const params = useSearchParams();
  const roomCode = params.get("room");
  return <div>Room Code: {roomCode}</div>;
};

export default createRoom;
