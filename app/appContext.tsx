"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from "@/types/webcam";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Merchant = { id: string; name: string; url: string };

export type PipelineCache = {
  sessionKey: string;
  renderUrl: string;
  renderPath: string;
  renderDurationMs: number;
  compositeUrl: string;
  compositePath: string;
  webcamSettings: WebcamSettings;
  trimmedUrl: string | null;
  trimStartSec: number;
  trimEndSec: number;
};

export type BrandArtifacts = {
  compositeUrl: string;
  compositePath: string;
  renderUrl: string;
  renderPath: string;
  renderDurationMs: number;
};

type PreviewCache = {
  sessionKey: string;
  trimStartSec: number;
  trimEndSec: number;
  webcamSettings: WebcamSettings;
  brandVideos: Record<string, string>;
  /** Per-brand composite artifacts for warm-start re-trim */
  brandArtifacts: Record<string, BrandArtifacts>;
};

type ProductDraft = {
  presenter: string;
  product: string;
  session: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  savedToLibrary: boolean;
  pipelineCache: PipelineCache | null;
  previewCache: PreviewCache | null;
};

type MerchantDraft = {
  presenter: string;
  merchantId: string;
  session: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  savedToLibrary: boolean;
  pipelineCache: PipelineCache | null;
};

type AppContextValue = {
  hydrated: boolean;

  users: string[];
  merchants: Merchant[];
  refreshUsers: () => Promise<void>;
  refreshMerchants: () => Promise<void>;
  addUser: (userId: string) => void;
  addMerchant: (merchant: Merchant) => void;

  product: ProductDraft;
  setProductPresenter: (presenter: string) => void;
  setProductProduct: (product: string) => void;
  setProductWebcamSettings: (settings: WebcamSettings) => void;
  setProductTrim: (startSec: number, endSec: number) => void;
  setProductPipelineCache: (cache: PipelineCache) => void;
  clearProductPipelineCache: () => void;
  setProductPreviewCache: (brandVideos: Record<string, string>, webcamSettings: WebcamSettings, brandArtifacts: Record<string, BrandArtifacts>) => void;
  markProductSaved: () => void;

  merchant: MerchantDraft;
  setMerchantPresenter: (presenter: string) => void;
  setMerchantMerchantId: (merchantId: string) => void;
  setMerchantWebcamSettings: (settings: WebcamSettings) => void;
  setMerchantTrim: (startSec: number, endSec: number) => void;
  setMerchantPipelineCache: (cache: PipelineCache) => void;
  clearMerchantPipelineCache: () => void;
  markMerchantSaved: () => void;
};

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_PRODUCT_KEY = "vlad_product_draft";
const LS_MERCHANT_KEY = "vlad_merchant_draft";
const LS_USERS_KEY = "vlad_users_cache";
const LS_MERCHANTS_KEY = "vlad_merchants_cache";

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded or private browsing */ }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function makeProductDraft(): ProductDraft {
  return {
    presenter: "",
    product: "",
    session: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    trimStartSec: 0,
    trimEndSec: 0,
    savedToLibrary: false,
    pipelineCache: null,
    previewCache: null,
  };
}

function makeMerchantDraft(): MerchantDraft {
  return {
    presenter: "",
    merchantId: "",
    session: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    trimStartSec: 0,
    trimEndSec: 0,
    savedToLibrary: false,
    pipelineCache: null,
  };
}

// ---------------------------------------------------------------------------
// Pure helper: determine which pipeline step to start from
// ---------------------------------------------------------------------------

export function computeStartStep(
  cache: PipelineCache | null,
  sessionKey: string,
  webcamSettings: WebcamSettings,
): 1 | 2 | 3 | "cached" {
  if (!cache || cache.sessionKey !== sessionKey) return 1;
  if (!cache.renderUrl || !cache.renderPath) return 1;

  // Render is valid — check if composite needs to be redone
  if (
    !cache.compositeUrl || !cache.compositePath ||
    cache.webcamSettings.webcamMode !== webcamSettings.webcamMode ||
    cache.webcamSettings.webcamVertical !== webcamSettings.webcamVertical ||
    cache.webcamSettings.webcamHorizontal !== webcamSettings.webcamHorizontal
  ) {
    return 2;
  }

  // Composite is valid — check if trim needs to be redone
  if (cache.trimmedUrl === null) return 3;

  return "cached";
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  const [users, setUsers] = useState<string[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const [productDraft, setProductDraft] = useState<ProductDraft>(makeProductDraft);
  const [merchantDraft, setMerchantDraft] = useState<MerchantDraft>(makeMerchantDraft);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setUsers(loadFromStorage(LS_USERS_KEY, []));
    setMerchants(loadFromStorage(LS_MERCHANTS_KEY, []));
    setProductDraft(loadFromStorage(LS_PRODUCT_KEY, makeProductDraft()));
    setMerchantDraft(loadFromStorage(LS_MERCHANT_KEY, makeMerchantDraft()));
    setHydrated(true);
  }, []);

  // Persist drafts (skip before hydration)
  const didHydrate = useRef(false);
  useEffect(() => {
    if (!didHydrate.current) { didHydrate.current = hydrated; return; }
    saveToStorage(LS_PRODUCT_KEY, productDraft);
  }, [productDraft, hydrated]);

  useEffect(() => {
    if (!didHydrate.current) return;
    saveToStorage(LS_MERCHANT_KEY, merchantDraft);
  }, [merchantDraft, hydrated]);

  // Fetch users/merchants from API
  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/list-users");
      const data = (await res.json()) as { users: string[] };
      setUsers(data.users);
      saveToStorage(LS_USERS_KEY, data.users);
    } catch { /* keep existing */ }
  }, []);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch("/api/list-merchants");
      const data = (await res.json()) as { merchants: Merchant[] };
      setMerchants(data.merchants);
      saveToStorage(LS_MERCHANTS_KEY, data.merchants);
    } catch { /* keep existing */ }
  }, []);

  useEffect(() => { refreshUsers(); refreshMerchants(); }, [refreshUsers, refreshMerchants]);

  const addUser = useCallback((userId: string) => {
    setUsers((prev) => {
      const next = prev.includes(userId) ? prev : [...prev, userId].sort();
      saveToStorage(LS_USERS_KEY, next);
      return next;
    });
  }, []);

  const addMerchant = useCallback((merchant: Merchant) => {
    setMerchants((prev) => {
      if (prev.some((m) => m.id === merchant.id)) return prev;
      const next = [...prev, merchant].sort((a, b) => a.name.localeCompare(b.name));
      saveToStorage(LS_MERCHANTS_KEY, next);
      return next;
    });
  }, []);

  // ---- Product flow ----
  const setProductPresenter = useCallback((presenter: string) => {
    setProductDraft((prev) => {
      const session = presenter && prev.product ? `${presenter}_${prev.product}` : "";
      return { ...makeProductDraft(), presenter, product: prev.product, session, webcamSettings: prev.webcamSettings };
    });
  }, []);

  const setProductProduct = useCallback((product: string) => {
    setProductDraft((prev) => {
      const session = prev.presenter && product ? `${prev.presenter}_${product}` : "";
      return { ...makeProductDraft(), presenter: prev.presenter, product, session, webcamSettings: prev.webcamSettings };
    });
  }, []);

  const setProductWebcamSettings = useCallback((settings: WebcamSettings) => {
    setProductDraft((prev) => {
      // Keep render artifacts, invalidate composite + trim
      const pc = prev.pipelineCache;
      const updatedCache: PipelineCache | null = pc && pc.renderUrl ? {
        ...pc,
        webcamSettings: settings,
        compositeUrl: "",
        compositePath: "",
        trimmedUrl: null,
      } : null;
      return { ...prev, webcamSettings: settings, pipelineCache: updatedCache, previewCache: null, savedToLibrary: false };
    });
  }, []);

  const setProductTrim = useCallback((startSec: number, endSec: number) => {
    setProductDraft((prev) => {
      // Keep render + composite, invalidate only trim
      const pc = prev.pipelineCache;
      const updatedCache: PipelineCache | null = pc ? {
        ...pc,
        trimmedUrl: null,
        trimStartSec: startSec,
        trimEndSec: endSec,
      } : null;
      // Keep preview brandArtifacts (composite paths) so re-trim can skip steps 1+2, but clear brandVideos (trimmed outputs)
      const pvc = prev.previewCache;
      const updatedPreview = pvc ? {
        ...pvc,
        trimStartSec: startSec,
        trimEndSec: endSec,
        brandVideos: {} as Record<string, string>,
      } : null;
      return { ...prev, trimStartSec: startSec, trimEndSec: endSec, pipelineCache: updatedCache, previewCache: updatedPreview, savedToLibrary: false };
    });
  }, []);

  const setProductPipelineCache = useCallback((cache: PipelineCache) => {
    setProductDraft((prev) => ({ ...prev, pipelineCache: cache }));
  }, []);

  const clearProductPipelineCache = useCallback(() => {
    setProductDraft((prev) => ({ ...prev, pipelineCache: null, previewCache: null, savedToLibrary: false }));
  }, []);

  const setProductPreviewCache = useCallback((brandVideos: Record<string, string>, webcamSettings: WebcamSettings, brandArtifacts: Record<string, BrandArtifacts>) => {
    setProductDraft((prev) => ({
      ...prev,
      previewCache: {
        sessionKey: `${prev.presenter}/${prev.session}`,
        trimStartSec: prev.trimStartSec,
        trimEndSec: prev.trimEndSec,
        webcamSettings: { ...webcamSettings },
        brandVideos,
        brandArtifacts,
      },
    }));
  }, []);

  const markProductSaved = useCallback(() => {
    setProductDraft((prev) => ({ ...prev, savedToLibrary: true }));
  }, []);

  // ---- Merchant flow ----
  const setMerchantPresenter = useCallback((presenter: string) => {
    setMerchantDraft((prev) => {
      const session = presenter && prev.merchantId ? `${presenter}_${prev.merchantId}` : "";
      return { ...makeMerchantDraft(), presenter, merchantId: prev.merchantId, session, webcamSettings: prev.webcamSettings };
    });
  }, []);

  const setMerchantMerchantId = useCallback((merchantId: string) => {
    setMerchantDraft((prev) => {
      const session = prev.presenter && merchantId ? `${prev.presenter}_${merchantId}` : "";
      return { ...makeMerchantDraft(), presenter: prev.presenter, merchantId, session, webcamSettings: prev.webcamSettings };
    });
  }, []);

  const setMerchantWebcamSettings = useCallback((settings: WebcamSettings) => {
    setMerchantDraft((prev) => {
      const pc = prev.pipelineCache;
      const updatedCache: PipelineCache | null = pc && pc.renderUrl ? {
        ...pc,
        webcamSettings: settings,
        compositeUrl: "",
        compositePath: "",
        trimmedUrl: null,
      } : null;
      return { ...prev, webcamSettings: settings, pipelineCache: updatedCache, savedToLibrary: false };
    });
  }, []);

  const setMerchantTrim = useCallback((startSec: number, endSec: number) => {
    setMerchantDraft((prev) => {
      const pc = prev.pipelineCache;
      const updatedCache: PipelineCache | null = pc ? {
        ...pc, trimmedUrl: null, trimStartSec: startSec, trimEndSec: endSec,
      } : null;
      return { ...prev, trimStartSec: startSec, trimEndSec: endSec, pipelineCache: updatedCache, savedToLibrary: false };
    });
  }, []);

  const setMerchantPipelineCache = useCallback((cache: PipelineCache) => {
    setMerchantDraft((prev) => ({ ...prev, pipelineCache: cache }));
  }, []);

  const clearMerchantPipelineCache = useCallback(() => {
    setMerchantDraft((prev) => ({ ...prev, pipelineCache: null, savedToLibrary: false }));
  }, []);

  const markMerchantSaved = useCallback(() => {
    setMerchantDraft((prev) => ({ ...prev, savedToLibrary: true }));
  }, []);

  // ---- Memoized value ----
  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
      users, merchants, refreshUsers, refreshMerchants, addUser, addMerchant,
      product: productDraft,
      setProductPresenter, setProductProduct, setProductWebcamSettings,
      setProductTrim, setProductPipelineCache, clearProductPipelineCache,
      setProductPreviewCache, markProductSaved,
      merchant: merchantDraft,
      setMerchantPresenter, setMerchantMerchantId, setMerchantWebcamSettings,
      setMerchantTrim, setMerchantPipelineCache,
      clearMerchantPipelineCache, markMerchantSaved,
    }),
    [
      hydrated,
      users, merchants, refreshUsers, refreshMerchants, addUser, addMerchant,
      productDraft, setProductPresenter, setProductProduct, setProductWebcamSettings,
      setProductTrim, setProductPipelineCache, clearProductPipelineCache,
      setProductPreviewCache, markProductSaved,
      merchantDraft, setMerchantPresenter, setMerchantMerchantId, setMerchantWebcamSettings,
      setMerchantTrim, setMerchantPipelineCache,
      clearMerchantPipelineCache, markMerchantSaved,
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
