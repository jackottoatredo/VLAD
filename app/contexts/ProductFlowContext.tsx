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

export type ProductFlowStep = 0 | 1 | 2 | 3; // Record, Postprocess, Preview, Saved
export type PersistedStatus = "unsaved" | "draft" | "saved";
export type FlowOrigin = "new" | "reopened";

type ProductFlowState = {
  step: ProductFlowStep;
  product: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  postprocessVideoR2Key: string | null;
  brandVideoUrls: Record<string, string>;
  // In-flight BullMQ job IDs for eager preview renders. Cleared as URLs resolve.
  postprocessJobId: string | null;
  brandJobIds: Record<string, string>;

  // Session identity. Allocated at commit() time by useRecording and surfaced
  // here via hydrateCommitted(). Used as the R2 path segment and the
  // vlad_recordings row id.
  flowId: string | null;
  name: string | null;
  origin: FlowOrigin;
  persistedStatus: PersistedStatus;
  /** True if the user has made any change since hydration/last-save. */
  dirtySinceLoad: boolean;
};

type HydrateArgs = {
  flowId: string;
  name: string;
  product: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  postprocessVideoR2Key: string | null;
  persistedStatus: PersistedStatus;
};

type ProductFlowContextValue = ProductFlowState & {
  setStep: (step: ProductFlowStep) => void;
  setProduct: (product: string) => void;
  setWebcamSettings: (settings: WebcamSettings) => void;
  setTrim: (startSec: number, endSec: number) => void;
  setPostprocessVideoUrl: (url: string | null, r2Key?: string | null) => void;
  setBrandVideoUrl: (brand: string, url: string) => void;
  setPostprocessJobId: (jobId: string | null) => void;
  setBrandJobId: (brand: string, jobId: string | null) => void;
  getActiveJobIds: () => string[];
  clearResults: () => void;

  /** Called by useRecording once a commit() upload succeeds. */
  hydrateCommitted: (flowId: string) => void;
  /** Populate the flow from an existing vlad_recordings row on reopen. */
  hydrateFromRecording: (args: HydrateArgs) => void;
  /** Mark the flow as persisted (draft or saved) — keeps state in context. */
  markPersisted: (args: { name: string; status: PersistedStatus }) => void;
  /** True if there is user content worth keeping that hasn't been saved. */
  hasUnsavedChanges: () => boolean;
  /** Fully reset + clear localStorage. */
  reset: () => void;
  /**
   * Discard the current recording session (clears flowId, render results, and
   * persisted draft/saved state) while preserving the user's product selection
   * and webcam settings. Used by "Record Again" when a recording has already
   * been committed to the flow.
   */
  discardRecording: () => void;
};

const LS_KEY = "vlad_product_flow";

function initialState(): ProductFlowState {
  return {
    step: 0,
    product: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    trimStartSec: 0,
    trimEndSec: 0,
    postprocessVideoUrl: null,
    postprocessVideoR2Key: null,
    brandVideoUrls: {},
    postprocessJobId: null,
    brandJobIds: {},
    flowId: null,
    name: null,
    origin: "new",
    persistedStatus: "unsaved",
    dirtySinceLoad: false,
  };
}

function loadState(): ProductFlowState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<ProductFlowState>;
    // Legacy blobs predate `flowId`. We can't reconstruct it, so treat them as
    // fresh state to avoid sending requests with a missing flowId.
    if (!parsed.flowId) return initialState();
    return { ...initialState(), ...parsed };
  } catch {
    return initialState();
  }
}

function saveState(state: ProductFlowState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function clearStored() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

const ProductFlowContext = createContext<ProductFlowContextValue | undefined>(undefined);

export function ProductFlowContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductFlowState>(loadState);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveState(state);
  }, [state]);

  const setStep = useCallback((step: ProductFlowStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const setProduct = useCallback((product: string) => {
    setState((prev) => ({
      ...initialState(),
      product,
      webcamSettings: prev.webcamSettings,
      dirtySinceLoad: true,
    }));
  }, []);

  const setWebcamSettings = useCallback((settings: WebcamSettings) => {
    setState((prev) => ({
      ...prev, webcamSettings: settings,
      postprocessVideoUrl: null, postprocessVideoR2Key: null, brandVideoUrls: {},
      postprocessJobId: null, brandJobIds: {},
      dirtySinceLoad: true,
    }));
  }, []);

  const setTrim = useCallback((startSec: number, endSec: number) => {
    setState((prev) => ({
      ...prev, trimStartSec: startSec, trimEndSec: endSec,
      dirtySinceLoad: true,
    }));
  }, []);

  const setPostprocessVideoUrl = useCallback((url: string | null, r2Key?: string | null) => {
    setState((prev) => ({
      ...prev,
      postprocessVideoUrl: url,
      postprocessVideoR2Key: r2Key ?? prev.postprocessVideoR2Key,
    }));
  }, []);

  const setBrandVideoUrl = useCallback((brand: string, url: string) => {
    setState((prev) => ({
      ...prev, brandVideoUrls: { ...prev.brandVideoUrls, [brand]: url },
    }));
  }, []);

  const setPostprocessJobId = useCallback((jobId: string | null) => {
    setState((prev) => ({ ...prev, postprocessJobId: jobId }));
  }, []);

  const setBrandJobId = useCallback((brand: string, jobId: string | null) => {
    setState((prev) => {
      const next = { ...prev.brandJobIds };
      if (jobId) next[brand] = jobId;
      else delete next[brand];
      return { ...prev, brandJobIds: next };
    });
  }, []);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const getActiveJobIds = useCallback(() => {
    const s = stateRef.current;
    const ids: string[] = [];
    if (s.postprocessJobId) ids.push(s.postprocessJobId);
    for (const v of Object.values(s.brandJobIds)) if (v) ids.push(v);
    return ids;
  }, []);

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev, trimStartSec: 0, trimEndSec: 0,
      postprocessVideoUrl: null, postprocessVideoR2Key: null, brandVideoUrls: {},
      postprocessJobId: null, brandJobIds: {},
    }));
  }, []);

  const hydrateCommitted = useCallback((flowId: string) => {
    setState((prev) => ({ ...prev, flowId, dirtySinceLoad: true }));
  }, []);

  const hydrateFromRecording = useCallback((args: HydrateArgs) => {
    setState(() => ({
      ...initialState(),
      flowId: args.flowId,
      name: args.name,
      product: args.product,
      webcamSettings: args.webcamSettings,
      trimStartSec: args.trimStartSec,
      trimEndSec: args.trimEndSec,
      postprocessVideoUrl: args.postprocessVideoUrl,
      postprocessVideoR2Key: args.postprocessVideoR2Key,
      persistedStatus: args.persistedStatus,
      origin: "reopened",
      dirtySinceLoad: false,
      step: 1, // Postprocess
    }));
  }, []);

  const markPersisted = useCallback(({ name, status }: { name: string; status: PersistedStatus }) => {
    setState((prev) => ({ ...prev, name, persistedStatus: status, dirtySinceLoad: false }));
  }, []);

  const hasUnsavedChanges = useCallback(() => {
    const s = stateRef.current;
    if (s.persistedStatus === "unsaved") {
      return !!s.flowId; // recording committed but not saved
    }
    return s.dirtySinceLoad;
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
    clearStored();
  }, []);

  const discardRecording = useCallback(() => {
    setState((prev) => ({
      ...initialState(),
      product: prev.product,
      webcamSettings: prev.webcamSettings,
    }));
  }, []);

  const value = useMemo<ProductFlowContextValue>(
    () => ({
      ...state,
      setStep, setProduct, setWebcamSettings, setTrim,
      setPostprocessVideoUrl, setBrandVideoUrl,
      setPostprocessJobId, setBrandJobId, getActiveJobIds,
      clearResults,
      hydrateCommitted, hydrateFromRecording, markPersisted, hasUnsavedChanges,
      reset, discardRecording,
    }),
    [
      state, setStep, setProduct, setWebcamSettings, setTrim, setPostprocessVideoUrl,
      setBrandVideoUrl, setPostprocessJobId, setBrandJobId, getActiveJobIds,
      clearResults, hydrateCommitted, hydrateFromRecording, markPersisted,
      hasUnsavedChanges, reset, discardRecording,
    ],
  );

  return <ProductFlowContext.Provider value={value}>{children}</ProductFlowContext.Provider>;
}

export function useProductFlow(): ProductFlowContextValue {
  const ctx = useContext(ProductFlowContext);
  if (!ctx) throw new Error("useProductFlow must be used within ProductFlowContextProvider");
  return ctx;
}
