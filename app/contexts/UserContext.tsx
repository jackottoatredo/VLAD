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

export type Merchant = { id: string; name: string; url: string };

type UserContextValue = {
  presenter: string;
  users: string[];
  merchants: Merchant[];
  setPresenter: (id: string) => void;
  addUser: (id: string) => void;
  addMerchant: (m: Merchant) => void;
  refreshUsers: () => Promise<void>;
  refreshMerchants: () => Promise<void>;
};

const LS_PRESENTER = "vlad_presenter";
const LS_USERS = "vlad_users_cache";
const LS_MERCHANTS = "vlad_merchants_cache";

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserContextProvider({ children }: { children: ReactNode }) {
  const [presenter, setPresenterState] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setPresenterState(loadLS(LS_PRESENTER, ""));
    setUsers(loadLS(LS_USERS, []));
    setMerchants(loadLS(LS_MERCHANTS, []));
  }, []);

  const setPresenter = useCallback((id: string) => {
    setPresenterState(id);
    saveLS(LS_PRESENTER, id);
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/list-users");
      const data = (await res.json()) as { users: string[] };
      setUsers(data.users);
      saveLS(LS_USERS, data.users);
    } catch { /* keep existing */ }
  }, []);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch("/api/list-merchants");
      const data = (await res.json()) as { merchants: Merchant[] };
      setMerchants(data.merchants);
      saveLS(LS_MERCHANTS, data.merchants);
    } catch { /* keep existing */ }
  }, []);

  useEffect(() => { refreshUsers(); refreshMerchants(); }, [refreshUsers, refreshMerchants]);

  const addUser = useCallback((id: string) => {
    setUsers((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id].sort();
      saveLS(LS_USERS, next);
      return next;
    });
  }, []);

  const addMerchant = useCallback((m: Merchant) => {
    setMerchants((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev;
      const next = [...prev, m].sort((a, b) => a.name.localeCompare(b.name));
      saveLS(LS_MERCHANTS, next);
      return next;
    });
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({ presenter, users, merchants, setPresenter, addUser, addMerchant, refreshUsers, refreshMerchants }),
    [presenter, users, merchants, setPresenter, addUser, addMerchant, refreshUsers, refreshMerchants],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserContextProvider");
  return ctx;
}
