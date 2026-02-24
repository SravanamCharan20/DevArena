import React from "react";

const SurfaceCard = ({ className = "", children }) => {
  return <section className={["panel", className].filter(Boolean).join(" ")}>{children}</section>;
};

export default SurfaceCard;
