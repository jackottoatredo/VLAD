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
