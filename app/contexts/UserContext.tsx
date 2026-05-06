"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";

type UserContextValue = {
  presenter: string;
  users: string[];
  refreshUsers: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const presenter = session?.user?.email ?? "";

  const [users, setUsers] = useState<string[]>([]);

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/list-users");
      const data = (await res.json()) as { users: string[] };
      setUsers(data.users);
    } catch {
      /* keep existing */
    }
  }, []);

  useEffect(() => {
    if (presenter) {
      refreshUsers();
    }
  }, [presenter, refreshUsers]);

  // DAU heartbeat — fire /api/activity once per session, rate-limited to once
  // per 6 hours via localStorage so refreshes and multi-tab don't spam the
  // event log. Server-side this just inserts a `user_active` row.
  useEffect(() => {
    if (!presenter) return;
    const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
    try {
      const last = Number(localStorage.getItem("vlad_activity_pinged_at") ?? 0);
      if (Date.now() - last < HEARTBEAT_MS) return;
      localStorage.setItem("vlad_activity_pinged_at", String(Date.now()));
    } catch {
      /* localStorage may be unavailable; still ping */
    }
    void fetch("/api/activity", { method: "POST" });
  }, [presenter]);

  const value = useMemo<UserContextValue>(
    () => ({
      presenter,
      users,
      refreshUsers,
    }),
    [presenter, users, refreshUsers],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserContextProvider");
  return ctx;
}
