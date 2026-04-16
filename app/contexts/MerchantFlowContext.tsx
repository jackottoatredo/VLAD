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

type MerchantFlowState = {
  step: MerchantFlowStep;
  merchantId: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  savedToLibrary: boolean;
};

type MerchantFlowContextValue = MerchantFlowState & {
  setStep: (step: MerchantFlowStep) => void;
  setMerchantId: (id: string) => void;
  setWebcamSettings: (settings: WebcamSettings) => void;
  setTrim: (startSec: number, endSec: number) => void;
  setPostprocessVideoUrl: (url: string | null) => void;
  clearResults: () => void;
  markSaved: () => void;
  reset: () => void;
};

const LS_KEY = "vlad_merchant_flow";

function initialState(): MerchantFlowState {
  return {
    step: 0,
    merchantId: "",
    webcamSettings: { ...DEFAULT_WEBCAM_SETTINGS },
    trimStartSec: 0,
    trimEndSec: 0,
    postprocessVideoUrl: null,
    savedToLibrary: false,
  };
}

function loadState(): MerchantFlowState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialState();
    return JSON.parse(raw) as MerchantFlowState;
  } catch {
    return initialState();
  }
}

function saveState(state: MerchantFlowState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
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

  const setMerchantId = useCallback((merchantId: string) => {
    setState((prev) => ({ ...initialState(), merchantId, webcamSettings: prev.webcamSettings }));
  }, []);

  const setWebcamSettings = useCallback((settings: WebcamSettings) => {
    setState((prev) => ({
      ...prev, webcamSettings: settings,
      postprocessVideoUrl: null, savedToLibrary: false,
    }));
  }, []);

  const setTrim = useCallback((startSec: number, endSec: number) => {
    setState((prev) => ({
      ...prev, trimStartSec: startSec, trimEndSec: endSec,
      savedToLibrary: false,
    }));
  }, []);

  const setPostprocessVideoUrl = useCallback((url: string | null) => {
    setState((prev) => ({ ...prev, postprocessVideoUrl: url }));
  }, []);

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev, trimStartSec: 0, trimEndSec: 0,
      postprocessVideoUrl: null, savedToLibrary: false,
    }));
  }, []);

  const markSaved = useCallback(() => {
    setState((prev) => ({ ...prev, savedToLibrary: true }));
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo<MerchantFlowContextValue>(
    () => ({
      ...state,
      setStep, setMerchantId, setWebcamSettings, setTrim,
      setPostprocessVideoUrl, clearResults, markSaved, reset,
    }),
    [state, setStep, setMerchantId, setWebcamSettings, setTrim, setPostprocessVideoUrl, clearResults, markSaved, reset],
  );

  return <MerchantFlowContext.Provider value={value}>{children}</MerchantFlowContext.Provider>;
}

export function useMerchantFlow(): MerchantFlowContextValue {
  const ctx = useContext(MerchantFlowContext);
  if (!ctx) throw new Error("useMerchantFlow must be used within MerchantFlowContextProvider");
  return ctx;
}
