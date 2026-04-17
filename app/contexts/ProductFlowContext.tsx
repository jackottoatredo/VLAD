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

type ProductFlowState = {
  step: ProductFlowStep;
  product: string;
  webcamSettings: WebcamSettings;
  trimStartSec: number;
  trimEndSec: number;
  postprocessVideoUrl: string | null;
  postprocessVideoR2Key: string | null;
  brandVideoUrls: Record<string, string>;
  savedToLibrary: boolean;
};

type ProductFlowContextValue = ProductFlowState & {
  setStep: (step: ProductFlowStep) => void;
  setProduct: (product: string) => void;
  setWebcamSettings: (settings: WebcamSettings) => void;
  setTrim: (startSec: number, endSec: number) => void;
  setPostprocessVideoUrl: (url: string | null, r2Key?: string | null) => void;
  setBrandVideoUrl: (brand: string, url: string) => void;
  clearResults: () => void;
  markSaved: () => void;
  reset: () => void;
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
    savedToLibrary: false,
  };
}

function loadState(): ProductFlowState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialState();
    return JSON.parse(raw) as ProductFlowState;
  } catch {
    return initialState();
  }
}

function saveState(state: ProductFlowState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const ProductFlowContext = createContext<ProductFlowContextValue | undefined>(undefined);

export function ProductFlowContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductFlowState>(loadState);
  const isFirstRender = useRef(true);

  // Persist to localStorage on change (skip the initial load)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveState(state);
  }, [state]);

  const setStep = useCallback((step: ProductFlowStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const setProduct = useCallback((product: string) => {
    setState((prev) => ({ ...initialState(), product, webcamSettings: prev.webcamSettings }));
  }, []);

  const setWebcamSettings = useCallback((settings: WebcamSettings) => {
    setState((prev) => ({
      ...prev, webcamSettings: settings,
      postprocessVideoUrl: null, postprocessVideoR2Key: null, brandVideoUrls: {}, savedToLibrary: false,
    }));
  }, []);

  const setTrim = useCallback((startSec: number, endSec: number) => {
    setState((prev) => ({
      ...prev, trimStartSec: startSec, trimEndSec: endSec,
      savedToLibrary: false,
    }));
  }, []);

  const setPostprocessVideoUrl = useCallback((url: string | null, r2Key?: string | null) => {
    setState((prev) => ({ ...prev, postprocessVideoUrl: url, postprocessVideoR2Key: r2Key ?? prev.postprocessVideoR2Key }));
  }, []);

  const setBrandVideoUrl = useCallback((brand: string, url: string) => {
    setState((prev) => ({
      ...prev, brandVideoUrls: { ...prev.brandVideoUrls, [brand]: url },
    }));
  }, []);

  const clearResults = useCallback(() => {
    setState((prev) => ({
      ...prev, trimStartSec: 0, trimEndSec: 0,
      postprocessVideoUrl: null, postprocessVideoR2Key: null, brandVideoUrls: {}, savedToLibrary: false,
    }));
  }, []);

  const markSaved = useCallback(() => {
    setState((prev) => ({ ...prev, savedToLibrary: true }));
    // Clear persisted state so revisiting the flow starts fresh
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const reset = useCallback(() => {
    setState(initialState());
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo<ProductFlowContextValue>(
    () => ({
      ...state,
      setStep, setProduct, setWebcamSettings, setTrim,
      setPostprocessVideoUrl, setBrandVideoUrl, clearResults, markSaved, reset,
    }),
    [state, setStep, setProduct, setWebcamSettings, setTrim, setPostprocessVideoUrl, setBrandVideoUrl, clearResults, markSaved, reset],
  );

  return <ProductFlowContext.Provider value={value}>{children}</ProductFlowContext.Provider>;
}

export function useProductFlow(): ProductFlowContextValue {
  const ctx = useContext(ProductFlowContext);
  if (!ctx) throw new Error("useProductFlow must be used within ProductFlowContextProvider");
  return ctx;
}
