import React from "react";
import ResultsClient from "./ResultsClient";

const ResultsPage = async ({ searchParams }) => {
  const params = await searchParams;
  const roomCode =
    typeof params?.room === "string" ? params.room.trim().toUpperCase() : "";

  return <ResultsClient roomCode={roomCode} />;
};

export default ResultsPage;
