import React from "react";

const ArenaPage = async ({ searchParams }) => {
  const params = await searchParams;
  const roomCode =
    typeof params?.room === "string" ? params.room.trim().toUpperCase() : "N/A";

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl p-8 shadow-xl text-center">
        <h2 className="text-2xl font-semibold mb-3">Arena</h2>
        <p>
          Room Code: <span className="font-bold">{roomCode}</span>
        </p>
      </div>
    </div>
  );
};

export default ArenaPage;
