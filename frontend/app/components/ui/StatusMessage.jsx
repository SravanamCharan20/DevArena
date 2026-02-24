import React from "react";

const variants = {
  ok: "status status-ok",
  warn: "status status-warn",
  error: "status status-error",
  info: "status status-info",
};

const StatusMessage = ({ variant = "info", children, role, className = "" }) => {
  if (!children) return null;

  return (
    <p className={[variants[variant] || variants.info, className].join(" ")} role={role}>
      {children}
    </p>
  );
};

export default StatusMessage;
