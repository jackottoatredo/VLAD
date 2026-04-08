"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AppContextValue = {
  url: string;
  width: string;
  height: string;
  fps: string;
  isRecording: boolean;
  errorMessage: string | null;
  videoUrl: string | null;
  setUrl: (value: string) => void;
  setWidth: (value: string) => void;
  setHeight: (value: string) => void;
  setFps: (value: string) => void;
  record: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState("");
  const [width, setWidth] = useState("1280");
  const [height, setHeight] = useState("720");
  const [fps, setFps] = useState("30");
  const [isRecording, setIsRecording] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const isValidUrl = useMemo(() => {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, [url]);

  const record = useCallback(async () => {
    setErrorMessage(null);
    setVideoUrl(null);

    if (!isValidUrl) {
      setErrorMessage("Please enter a valid http/https URL.");
      return;
    }

    const numericWidth = Number(width);
    const numericHeight = Number(height);
    const numericFps = Number(fps);

    if (
      !Number.isFinite(numericWidth) ||
      !Number.isFinite(numericHeight) ||
      !Number.isFinite(numericFps)
    ) {
      setErrorMessage("Width, height, and FPS must be numbers.");
      return;
    }

    setIsRecording(true);

    try {
      const response = await fetch("/api/record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          width: numericWidth,
          height: numericHeight,
          fps: numericFps,
          durationMs: 1000,
          waitUntil: "domcontentloaded",
        }),
      });

      const payload = (await response.json()) as
        | { videoUrl?: string; error?: string }
        | undefined;

      if (!response.ok || !payload?.videoUrl) {
        setErrorMessage(payload?.error ?? "Failed to create recording.");
        return;
      }

      setVideoUrl(payload.videoUrl);
    } catch {
      setErrorMessage("Unexpected error while recording. Check server logs.");
    } finally {
      setIsRecording(false);
    }
  }, [fps, height, isValidUrl, url, width]);

  const value = useMemo<AppContextValue>(
    () => ({
      url,
      width,
      height,
      fps,
      isRecording,
      errorMessage,
      videoUrl,
      setUrl,
      setWidth,
      setHeight,
      setFps,
      record,
    }),
    [errorMessage, fps, height, isRecording, record, url, videoUrl, width]
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
