"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import socket from "./socket";
import { useUser } from "./UserContext";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useUser();
  const [connected, setConnected] = useState(socket.connected);
  const [socketName, setSocketName] = useState("");

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (!socket.connected) socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!connected || !user?.username) return;

    socket.emit("register-user", { username: user.username }, (ack) => {
      if (!ack?.ok) return;
      setSocketName(ack.username);
    });
  }, [connected, user?.username]);

  const value = useMemo(
    () => ({ socket, connected, socketName }),
    [connected, socketName]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used inside SocketProvider");
  return ctx;
}
