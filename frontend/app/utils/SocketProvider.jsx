"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import socket from "./socket";
import { useUser } from "./UserContext";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useUser();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, []);

  useEffect(() => {
    if (user && !socket.connected) {
      socket.connect();
      return;
    }

    if (!user && socket.connected) {
      socket.disconnect();
    }
  }, [user]);

  const value = useMemo(() => ({ socket, connected }), [connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used inside SocketProvider");
  return ctx;
}
