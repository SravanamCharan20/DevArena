import React from "react";

const CreateRoomPage = async ({ searchParams }) => {
  const params = await searchParams;
  const roomCode = params?.room || "N/A";

  return <div>Room Code: {roomCode}</div>;
};

export default CreateRoomPage;
