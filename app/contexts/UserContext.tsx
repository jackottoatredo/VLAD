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

export type Merchant = { id: string; name: string; url: string };

type UserContextValue = {
  presenter: string;
  users: string[];
  merchants: Merchant[];
  addMerchant: (m: Merchant) => void;
  refreshUsers: () => Promise<void>;
  refreshMerchants: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserContextProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const presenter = session?.user?.email ?? "";

  const [users, setUsers] = useState<string[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/list-users");
      const data = (await res.json()) as { users: string[] };
      setUsers(data.users);
    } catch {
      /* keep existing */
    }
  }, []);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch("/api/list-merchants");
      const data = (await res.json()) as { merchants: Merchant[] };
      setMerchants(data.merchants);
    } catch {
      /* keep existing */
    }
  }, []);

  useEffect(() => {
    if (presenter) {
      refreshUsers();
      refreshMerchants();
    }
  }, [presenter, refreshUsers, refreshMerchants]);

  const addMerchant = useCallback((m: Merchant) => {
    setMerchants((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev;
      return [...prev, m].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({
      presenter,
      users,
      merchants,
      addMerchant,
      refreshUsers,
      refreshMerchants,
    }),
    [presenter, users, merchants, addMerchant, refreshUsers, refreshMerchants],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserContextProvider");
  return ctx;
}
