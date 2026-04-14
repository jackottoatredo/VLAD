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
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Merchant = { id: string; name: string; url: string };

/** Tracks whether a draft recording or its trim has changed since last render. */
type DirtyFlags = {
  /** True after a new recording is saved to disk (mouse+webcam). Cleared when postprocess renders. */
  recording: boolean;
  /** True after trim marks change. Cleared when preview regenerates with new trim. */
  trim: boolean;
};

type ProductDraft = {
  presenter: string;
  product: string;
  session: string; // derived: `${presenter}_${product}`
  webcamSettings: WebcamSettings;
  dirty: DirtyFlags;
  savedToLibrary: boolean;
};

type MerchantDraft = {
  presenter: string;
  merchantId: string;
  session: string; // derived: `${presenter}_${merchantId}`
  webcamSettings: WebcamSettings;
  dirty: DirtyFlags;
  savedToLibrary: boolean;
};

type AppContextValue = {
  // Global reference data
  users: string[];
  merchants: Merchant[];
  refreshUsers: () => Promise<void>;
  refreshMerchants: () => Promise<void>;
  addUser: (userId: string) => void;
  addMerchant: (merchant: Merchant) => void;

  // Product flow state
  product: ProductDraft;
  setProductPresenter: (presenter: string) => void;
  setProductProduct: (product: string) => void;
  setProductWebcamSettings: (settings: WebcamSettings) => void;
  markProductRecordingDirty: () => void;
  markProductRecordingClean: () => void;
  markProductTrimDirty: () => void;
  markProductTrimClean: () => void;
  markProductSaved: () => void;

  // Merchant flow state
  merchant: MerchantDraft;
  setMerchantPresenter: (presenter: string) => void;
  setMerchantMerchantId: (merchantId: string) => void;
  setMerchantWebcamSettings: (settings: WebcamSettings) => void;
  markMerchantRecordingDirty: () => void;
  markMerchantRecordingClean: () => void;
  markMerchantTrimDirty: () => void;
  markMerchantTrimClean: () => void;
  markMerchantSaved: () => void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const INITIAL_DIRTY: DirtyFlags = { recording: false, trim: false };

function makeProductDraft(): ProductDraft {
  return {
    presenter: "",
    product: "",
    session: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    dirty: { ...INITIAL_DIRTY },
    savedToLibrary: false,
  };
}

function makeMerchantDraft(): MerchantDraft {
  return {
    presenter: "",
    merchantId: "",
    session: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    dirty: { ...INITIAL_DIRTY },
    savedToLibrary: false,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
  // ---- Global reference data ----
  const [users, setUsers] = useState<string[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/list-users");
      const data = (await res.json()) as { users: string[] };
      setUsers(data.users);
    } catch {
      /* keep existing list */
    }
  }, []);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch("/api/list-merchants");
      const data = (await res.json()) as { merchants: Merchant[] };
      setMerchants(data.merchants);
    } catch {
      /* keep existing list */
    }
  }, []);

  const addUser = useCallback((userId: string) => {
    setUsers((prev) =>
      prev.includes(userId) ? prev : [...prev, userId].sort()
    );
  }, []);

  const addMerchant = useCallback((merchant: Merchant) => {
    setMerchants((prev) => {
      if (prev.some((m) => m.id === merchant.id)) return prev;
      return [...prev, merchant].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  // Fetch on mount
  useEffect(() => {
    refreshUsers();
    refreshMerchants();
  }, [refreshUsers, refreshMerchants]);

  // ---- Product flow ----
  const [productDraft, setProductDraft] = useState<ProductDraft>(makeProductDraft);

  const setProductPresenter = useCallback((presenter: string) => {
    setProductDraft((prev) => {
      const session = presenter && prev.product ? `${presenter}_${prev.product}` : "";
      return { ...prev, presenter, session, dirty: { ...INITIAL_DIRTY }, savedToLibrary: false };
    });
  }, []);

  const setProductProduct = useCallback((product: string) => {
    setProductDraft((prev) => {
      const session = prev.presenter && product ? `${prev.presenter}_${product}` : "";
      return { ...prev, product, session, dirty: { ...INITIAL_DIRTY }, savedToLibrary: false };
    });
  }, []);

  const setProductWebcamSettings = useCallback((settings: WebcamSettings) => {
    setProductDraft((prev) => ({ ...prev, webcamSettings: settings }));
  }, []);

  const markProductRecordingDirty = useCallback(() => {
    setProductDraft((prev) => ({
      ...prev,
      dirty: { recording: true, trim: true },
      savedToLibrary: false,
    }));
  }, []);

  const markProductRecordingClean = useCallback(() => {
    setProductDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, recording: false },
    }));
  }, []);

  const markProductTrimDirty = useCallback(() => {
    setProductDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, trim: true },
      savedToLibrary: false,
    }));
  }, []);

  const markProductTrimClean = useCallback(() => {
    setProductDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, trim: false },
    }));
  }, []);

  const markProductSaved = useCallback(() => {
    setProductDraft((prev) => ({ ...prev, savedToLibrary: true }));
  }, []);

  // ---- Merchant flow ----
  const [merchantDraft, setMerchantDraft] = useState<MerchantDraft>(makeMerchantDraft);

  const setMerchantPresenter = useCallback((presenter: string) => {
    setMerchantDraft((prev) => {
      const session = presenter && prev.merchantId ? `${presenter}_${prev.merchantId}` : "";
      return { ...prev, presenter, session, dirty: { ...INITIAL_DIRTY }, savedToLibrary: false };
    });
  }, []);

  const setMerchantMerchantId = useCallback((merchantId: string) => {
    setMerchantDraft((prev) => {
      const session = prev.presenter && merchantId ? `${prev.presenter}_${merchantId}` : "";
      return { ...prev, merchantId, session, dirty: { ...INITIAL_DIRTY }, savedToLibrary: false };
    });
  }, []);

  const setMerchantWebcamSettings = useCallback((settings: WebcamSettings) => {
    setMerchantDraft((prev) => ({ ...prev, webcamSettings: settings }));
  }, []);

  const markMerchantRecordingDirty = useCallback(() => {
    setMerchantDraft((prev) => ({
      ...prev,
      dirty: { recording: true, trim: true },
      savedToLibrary: false,
    }));
  }, []);

  const markMerchantRecordingClean = useCallback(() => {
    setMerchantDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, recording: false },
    }));
  }, []);

  const markMerchantTrimDirty = useCallback(() => {
    setMerchantDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, trim: true },
      savedToLibrary: false,
    }));
  }, []);

  const markMerchantTrimClean = useCallback(() => {
    setMerchantDraft((prev) => ({
      ...prev,
      dirty: { ...prev.dirty, trim: false },
    }));
  }, []);

  const markMerchantSaved = useCallback(() => {
    setMerchantDraft((prev) => ({ ...prev, savedToLibrary: true }));
  }, []);

  // ---- Memoized context value ----
  const value = useMemo<AppContextValue>(
    () => ({
      users,
      merchants,
      refreshUsers,
      refreshMerchants,
      addUser,
      addMerchant,

      product: productDraft,
      setProductPresenter,
      setProductProduct,
      setProductWebcamSettings,
      markProductRecordingDirty,
      markProductRecordingClean,
      markProductTrimDirty,
      markProductTrimClean,
      markProductSaved,

      merchant: merchantDraft,
      setMerchantPresenter,
      setMerchantMerchantId,
      setMerchantWebcamSettings,
      markMerchantRecordingDirty,
      markMerchantRecordingClean,
      markMerchantTrimDirty,
      markMerchantTrimClean,
      markMerchantSaved,
    }),
    [
      users, merchants, refreshUsers, refreshMerchants, addUser, addMerchant,
      productDraft, setProductPresenter, setProductProduct, setProductWebcamSettings,
      markProductRecordingDirty, markProductRecordingClean, markProductTrimDirty, markProductTrimClean, markProductSaved,
      merchantDraft, setMerchantPresenter, setMerchantMerchantId, setMerchantWebcamSettings,
      markMerchantRecordingDirty, markMerchantRecordingClean, markMerchantTrimDirty, markMerchantTrimClean, markMerchantSaved,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider.");
  }
  return context;
}
