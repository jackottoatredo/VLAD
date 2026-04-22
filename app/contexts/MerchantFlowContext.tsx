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

export type MerchantFlowStep = 0 | 1 | 2; // Record, Postprocess, Saved
export type PersistedStatus = "unsaved" | "draft" | "saved";
export type FlowOrigin = "new" | "reopened";

export type SelectedMerchant = {
  id: string;
  brandName: string;
  websiteUrl: string;
};

type MerchantFlowState = {
  step: MerchantFlowStep;
  merchantId: string;
  brandName: string;
  websiteUrl: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  postprocessVideoR2Key: string | null;
  postprocessJobId: string | null;

  flowId: string | null;
  name: string | null;
  origin: FlowOrigin;
  persistedStatus: PersistedStatus;
  dirtySinceLoad: boolean;
};

type HydrateArgs = {
  flowId: string;
  name: string;
  merchantId: string;
  brandName: string;
  websiteUrl: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  postprocessVideoR2Key: string | null;
  persistedStatus: PersistedStatus;
};

type MerchantFlowContextValue = MerchantFlowState & {
  setStep: (step: MerchantFlowStep) => void;
  setMerchant: (merchant: SelectedMerchant | null) => void;
  setWebcamSettings: (settings: WebcamSettings) => void;
  setTrim: (startSec: number, endSec: number) => void;
  setPostprocessVideoUrl: (url: string | null, r2Key?: string | null) => void;
  setPostprocessJobId: (jobId: string | null) => void;
  getActiveJobIds: () => string[];
  clearResults: () => void;

  hydrateCommitted: (flowId: string) => void;
  hydrateFromRecording: (args: HydrateArgs) => void;
  markPersisted: (args: { name: string; status: PersistedStatus }) => void;
  hasUnsavedChanges: () => boolean;
  reset: () => void;
};

const LS_KEY = "vlad_merchant_flow";

function initialState(): MerchantFlowState {
  return {
    step: 0,
    merchantId: "",
    brandName: "",
    websiteUrl: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    trimStartSec: 0,
    trimEndSec: 0,
    postprocessVideoUrl: null,
    postprocessVideoR2Key: null,
    postprocessJobId: null,
    flowId: null,
    name: null,
    origin: "new",
    persistedStatus: "unsaved",
    dirtySinceLoad: false,
  };
}

function loadState(): MerchantFlowState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<MerchantFlowState>;
    if (!parsed.flowId) return initialState();
    return { ...initialState(), ...parsed };
  } catch {
    return initialState();
  }
}

function saveState(state: MerchantFlowState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function clearStored() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

const MerchantFlowContext = createContext<MerchantFlowContextValue | undefined>(undefined);

export function MerchantFlowContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MerchantFlowState>(loadState);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveState(state);
  }, [state]);

  const setStep = useCallback((step: MerchantFlowStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const setMerchant = useCallback((merchant: SelectedMerchant | null) => {
    setState((prev) => ({
      ...initialState(),
      merchantId: merchant?.id ?? "",
      brandName: merchant?.brandName ?? "",
      websiteUrl: merchant?.websiteUrl ?? "",
      webcamSettings: prev.webcamSettings,
      dirtySinceLoad: true,
    }));
  }, []);

  const setWebcamSettings = useCallback((settings: WebcamSettings) => {
    setState((prev) => ({
      ...prev, webcamSettings: settings,
      postprocessVideoUrl: null, postprocessVideoR2Key: null,
      postprocessJobId: null,
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

  const setPostprocessJobId = useCallback((jobId: string | null) => {
    setState((prev) => ({ ...prev, postprocessJobId: jobId }));
  }, []);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const getActiveJobIds = useCallback(() => {
    const s = stateRef.current;
    return s.postprocessJobId ? [s.postprocessJobId] : [];
  }, []);

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev, trimStartSec: 0, trimEndSec: 0,
      postprocessVideoUrl: null, postprocessVideoR2Key: null,
      postprocessJobId: null,
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
      merchantId: args.merchantId,
      brandName: args.brandName,
      websiteUrl: args.websiteUrl,
      webcamSettings: args.webcamSettings,
      trimStartSec: args.trimStartSec,
      trimEndSec: args.trimEndSec,
      postprocessVideoUrl: args.postprocessVideoUrl,
      postprocessVideoR2Key: args.postprocessVideoR2Key,
      persistedStatus: args.persistedStatus,
      origin: "reopened",
      dirtySinceLoad: false,
      step: 1,
    }));
  }, []);

  const markPersisted = useCallback(({ name, status }: { name: string; status: PersistedStatus }) => {
    setState((prev) => ({ ...prev, name, persistedStatus: status, dirtySinceLoad: false }));
  }, []);

  const hasUnsavedChanges = useCallback(() => {
    const s = stateRef.current;
    if (s.persistedStatus === "unsaved") return !!s.flowId;
    return s.dirtySinceLoad;
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
    clearStored();
  }, []);

  const value = useMemo<MerchantFlowContextValue>(
    () => ({
      ...state,
      setStep, setMerchant, setWebcamSettings, setTrim,
      setPostprocessVideoUrl, setPostprocessJobId, getActiveJobIds,
      clearResults,
      hydrateCommitted, hydrateFromRecording, markPersisted, hasUnsavedChanges,
      reset,
    }),
    [
      state, setStep, setMerchant, setWebcamSettings, setTrim,
      setPostprocessVideoUrl, setPostprocessJobId, getActiveJobIds,
      clearResults, hydrateCommitted, hydrateFromRecording, markPersisted,
      hasUnsavedChanges, reset,
    ],
  );

  return <MerchantFlowContext.Provider value={value}>{children}</MerchantFlowContext.Provider>;
}

export function useMerchantFlow(): MerchantFlowContextValue {
  const ctx = useContext(MerchantFlowContext);
  if (!ctx) throw new Error("useMerchantFlow must be used within MerchantFlowContextProvider");
  return ctx;
}
