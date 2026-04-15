"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, WEBCAM_RECORDER_TIMESLICE_MS } from "@/app/config";
import type { WebcamMode } from "@/types/webcam";

const IFRAME_WIDTH = Math.round(VIDEO_WIDTH / RENDER_ZOOM);
const IFRAME_HEIGHT = Math.round(VIDEO_HEIGHT / RENDER_ZOOM);

type RelayEvent = {
  eventType: string;
  x: number;
  y: number;
  buttons: number;
  timestamp: number;
};

type UseRecordingOpts = {
  webcamMode: WebcamMode;
  onSaved?: () => void;
};

export function useRecording({ webcamMode, onSaved }: UseRecordingOpts) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const eventsRef = useRef<RelayEvent[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingKey, setRecordingKey] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Snapshot refs for async save
  const dirNameRef = useRef("");
  const presenterRef = useRef("");
  const recordingStartedAt = useRef("");

  // Webcam
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamChunksRef = useRef<Blob[]>([]);

  // Relay event listener
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.source !== "mouse-relay") return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      const event: RelayEvent = { ...e.data.payload, timestamp: performance.now() };
      if (isRecording) eventsRef.current.push(event);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isRecording]);

  // Webcam stream lifecycle
  useEffect(() => {
    if (webcamMode === "off") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        if (webcamVideoRef.current) webcamVideoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [webcamMode]);

  const beginRecording = useCallback((presenter: string, identifier: string) => {
    const dn = `${presenter}_${identifier}`;
    dirNameRef.current = dn;
    presenterRef.current = presenter;
    recordingStartedAt.current = new Date().toISOString();
    eventsRef.current = [{ eventType: "recording-start", x: 0, y: 0, buttons: 0, timestamp: performance.now() }];
    setIsRecording(true);

    if (streamRef.current) {
      webcamChunksRef.current = [];
      const mr = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) webcamChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = mr;
      mr.start(WEBCAM_RECORDER_TIMESLICE_MS);
    }
  }, []);

  const clearCountdown = useCallback(() => {
    countdownTimeoutsRef.current.forEach(clearTimeout);
    countdownTimeoutsRef.current = [];
    setCountdown(null);
  }, []);

  const start = useCallback((presenter: string, identifier: string) => {
    clearCountdown();
    setRecordingKey((k) => k + 1); // refresh iframe immediately
    setCountdown(3);
    const timeouts = [
      setTimeout(() => setCountdown(2), 1000),
      setTimeout(() => setCountdown(1), 2000),
      setTimeout(() => {
        setCountdown(null);
        beginRecording(presenter, identifier);
      }, 3000),
    ];
    countdownTimeoutsRef.current = timeouts;
  }, [beginRecording, clearCountdown]);

  const stop = useCallback(async () => {
    clearCountdown();
    setIsRecording(false);
    const dn = dirNameRef.current;
    const presenter = presenterRef.current;

    const mousePromise = fetch("/api/save-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: dn,
        presenter,
        recordedAt: recordingStartedAt.current,
        virtualWidth: IFRAME_WIDTH,
        virtualHeight: IFRAME_HEIGHT,
        events: eventsRef.current,
      }),
    });

    const webcamPromise = new Promise<void>((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") { resolve(); return; }
      mr.onstop = async () => {
        const blob = new Blob(webcamChunksRef.current, { type: "video/webm" });
        const fd = new FormData();
        fd.append("session", dn);
        fd.append("presenter", presenter);
        fd.append("video", blob, `${dn}_webcam.webm`);
        await fetch("/api/save-webcam", { method: "POST", body: fd }).catch(() => {});
        resolve();
      };
      mr.stop();
    });

    await Promise.all([mousePromise, webcamPromise]);
    onSaved?.();
  }, [onSaved, clearCountdown]);

  return {
    iframeRef,
    webcamVideoRef,
    isRecording,
    countdown,
    recordingKey,
    start,
    stop,
  };
}
