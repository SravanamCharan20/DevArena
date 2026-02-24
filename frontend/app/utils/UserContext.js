"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "./config";

const UserContext = createContext(null);

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState(null);
  const router = useRouter();

  const refreshActiveRoom = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/contest/active`, {
        credentials: "include",
      });

      if (!res.ok) {
        setActiveRoom(null);
        return null;
      }

      const data = await res.json();
      const nextActiveRoom = data?.activeRoom || null;
      setActiveRoom(nextActiveRoom);

      return nextActiveRoom;
    } catch {
      setActiveRoom(null);
      return null;
    }
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/profile`, {
          credentials: "include",
        });

        if (!res.ok) {
          router.push("/auth/signin");
          throw new Error("Not authenticated");
        }

        const data = await res.json();
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [router]);

  useEffect(() => {
    if (!user) {
      setActiveRoom(null);
      return;
    }

    refreshActiveRoom();
  }, [user, refreshActiveRoom]);

  return (
    <UserContext.Provider
      value={{
        user,
        setUser,
        loading,
        activeRoom,
        refreshActiveRoom,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
