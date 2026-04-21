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
};

type PendingRecording = {
  dn: string;
  presenter: string;
  recordedAt: string;
  events: RelayEvent[];
  webcamBlob: Blob | null;
};

export function useRecording({ webcamMode }: UseRecordingOpts) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const eventsRef = useRef<RelayEvent[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingKey, setRecordingKey] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  // 'idle'      → nothing in flight
  // 'uploading' → stop() called, mouse.json + webcam.webm being POSTed to R2
  // 'ready'     → uploads done, awaiting user confirmation (Record Again vs Continue)
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "ready">("idle");
  const countdownTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Snapshot refs for async save
  const dirNameRef = useRef("");
  const presenterRef = useRef("");
  const recordingStartedAt = useRef("");

  // Captured recording held in memory after stop() until the user confirms via commit()
  // or discards via start() (Record Again).
  const pendingRef = useRef<PendingRecording | null>(null);

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
      if (videoElRef.current) videoElRef.current.srcObject = null;
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const el = videoElRef.current;
        if (el) {
          el.srcObject = stream;
          el.play().catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [webcamMode]);

  // Ref callback: re-binds srcObject every time the <video> element mounts.
  // Fixes blank webcam when returning to the record step — useRecording lives
  // at the wizard level so the stream persists, but the video element is
  // recreated on each RecordStep mount.
  const webcamVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const beginRecording = useCallback((presenter: string, identifier: string) => {
    const dn = `${presenter}_${identifier}`;
    dirNameRef.current = dn;
    presenterRef.current = presenter;
    recordingStartedAt.current = new Date().toISOString();
    eventsRef.current = [{ eventType: "recording-start", x: 0, y: 0, buttons: 0, timestamp: performance.now() }];
    setUploadStatus("idle");
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
    // Clear the confirmation guard immediately so "Record Again" doesn't leave the
    // overlay visible during the 3s countdown. Also discard any prior take — its
    // mouse events + webcam blob haven't been uploaded yet, so they die here.
    setUploadStatus("idle");
    pendingRef.current = null;
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

    // Finalize the webcam blob from whatever MediaRecorder buffered, but don't upload.
    const webcamBlob = await new Promise<Blob | null>((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") { resolve(null); return; }
      mr.onstop = () => {
        resolve(new Blob(webcamChunksRef.current, { type: "video/webm" }));
      };
      mr.stop();
    });

    pendingRef.current = {
      dn,
      presenter,
      recordedAt: recordingStartedAt.current,
      events: eventsRef.current,
      webcamBlob,
    };
    setUploadStatus("ready");
  }, [clearCountdown]);

  // Upload the pending recording to R2. Caller awaits this before doing anything that
  // depends on the session blobs being in storage (e.g. enqueueing produce jobs).
  const commit = useCallback(async (): Promise<boolean> => {
    const pending = pendingRef.current;
    if (!pending) return false;
    setUploadStatus("uploading");
    try {
      const mousePromise = fetch("/api/save-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: pending.dn,
          presenter: pending.presenter,
          recordedAt: pending.recordedAt,
          virtualWidth: IFRAME_WIDTH,
          virtualHeight: IFRAME_HEIGHT,
          events: pending.events,
        }),
      });

      const webcamPromise: Promise<unknown> = pending.webcamBlob
        ? (() => {
            const fd = new FormData();
            fd.append("session", pending.dn);
            fd.append("presenter", pending.presenter);
            fd.append("video", pending.webcamBlob, `${pending.dn}_webcam.webm`);
            return fetch("/api/save-webcam", { method: "POST", body: fd });
          })()
        : Promise.resolve();

      await Promise.all([mousePromise, webcamPromise]);
      pendingRef.current = null;
      return true;
    } catch (err) {
      console.error("[useRecording] commit failed", err);
      setUploadStatus("ready");
      return false;
    }
  }, []);

  return {
    iframeRef,
    webcamVideoRef,
    isRecording,
    countdown,
    recordingKey,
    uploadStatus,
    start,
    stop,
    commit,
  };
}
