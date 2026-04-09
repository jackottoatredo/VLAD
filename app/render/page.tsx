"use client";

import { useEffect, useRef, useState } from "react";
import PageNav from "@/app/components/PageNav";

type RecordingEntry = {
  name: string;
  recordedAt: string;
};

type PageState =
  | { status: "loading-list" | "ready" }
  | { status: "rendering"; jobId: string; rendered: number; total: number }
  | { status: "compositing"; jobId: string; composited: number; total: number }
  | { status: "done"; videoUrl: string }
  | { status: "error"; message: string };

const JOB_POLL_INTERVAL_MS = 500;

export default function RenderPage() {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [state, setState] = useState<PageState>({ status: "loading-list" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/list-recordings")
      .then((r) => r.json())
      .then((data: { recordings: RecordingEntry[] }) => {
        setRecordings(data.recordings);
        if (data.recordings.length > 0) setSelectedSession(data.recordings[0].name);
        setState({ status: "ready" });
      })
      .catch(() => setState({ status: "error", message: "Failed to load session list." }));
  }, []);

  // Poll progress while rendering or compositing
  useEffect(() => {
    const isActive = state.status === "rendering" || state.status === "compositing";
    if (!isActive) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const { jobId } = state;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/render-progress/${jobId}`);
        const job = await res.json() as {
          status: string;
          rendered?: number;
          total?: number;
          composited?: number;
          videoUrl?: string;
          message?: string;
        };
        if (job.status === "done" && job.videoUrl) {
          setState({ status: "done", videoUrl: job.videoUrl });
        } else if (job.status === "error") {
          setState({ status: "error", message: job.message ?? "Render failed." });
        } else if (job.status === "rendering") {
          setState((prev) =>
            prev.status === "rendering"
              ? { ...prev, rendered: job.rendered ?? 0, total: job.total ?? 0 }
              : prev
          );
        } else if (job.status === "compositing") {
          setState((prev) =>
            prev.status === "rendering" || prev.status === "compositing"
              ? { status: "compositing", jobId, composited: job.composited ?? 0, total: job.total ?? 0 }
              : prev
          );
        }
      } catch {
        // transient fetch error — keep polling
      }
    }, JOB_POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.status === "rendering" || state.status === "compositing" ? (state as { jobId: string }).jobId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRender() {
    if (!selectedSession) return;
    try {
      const response = await fetch("/api/render-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: selectedSession }),
      });
      const payload = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) {
        setState({ status: "error", message: payload.error ?? "Failed to start render." });
        return;
      }
      setState({ status: "rendering", jobId: payload.jobId, rendered: 0, total: 0 });
    } catch {
      setState({ status: "error", message: "Unexpected error. Check server logs." });
    }
  }

  const isLoadingList = state.status === "loading-list";
  const isWorking = state.status === "rendering" || state.status === "compositing";
  const canRender = !isLoadingList && !isWorking && selectedSession !== "";

  const renderProgress =
    state.status === "rendering" && state.total > 0
      ? Math.round((state.rendered / state.total) * 100)
      : state.status === "compositing" || state.status === "done"
      ? 100
      : 0;

  const composeProgress =
    state.status === "compositing" && state.total > 0
      ? Math.round((state.composited / state.total) * 100)
      : state.status === "done"
      ? 100
      : 0;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-4xl space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-zinc-950 sm:p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Render Session
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Select a recorded session and export it as an MP4.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={selectedSession}
            onChange={(e) => {
              setSelectedSession(e.target.value);
              setState({ status: "ready" });
            }}
            disabled={isLoadingList || isWorking}
            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {isLoadingList && <option value="">Loading sessions…</option>}
            {!isLoadingList && recordings.length === 0 && (
              <option value="">No sessions recorded yet</option>
            )}
            {recordings.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} — {new Date(r.recordedAt).toLocaleString()}
              </option>
            ))}
          </select>

          <button
            onClick={handleRender}
            disabled={!canRender}
            className="h-10 shrink-0 rounded-lg bg-zinc-900 px-6 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {state.status === "rendering" ? "Rendering…" : state.status === "compositing" ? "Compositing…" : "Render"}
          </button>
        </div>

        {state.status === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        )}

        {(isWorking || state.status === "done") && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {state.status === "rendering"
                    ? state.total > 0
                      ? `Rendering — frame ${state.rendered} of ${state.total}`
                      : "Rendering — starting…"
                    : "Rendering — complete"}
                </span>
                <span>{renderProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>

            {(state.status === "compositing" || state.status === "done") && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    {state.status === "compositing"
                      ? state.total > 0
                        ? `Compositing — step ${state.composited} of ${state.total}`
                        : "Compositing — starting…"
                      : "Compositing — complete"}
                  </span>
                  <span>{composeProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                    style={{ width: `${composeProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {state.status === "done" && (
          <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Saved at{" "}
              <a
                href={state.videoUrl}
                className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                {state.videoUrl}
              </a>
            </p>
            <a
              href={state.videoUrl}
              download
              className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Download MP4
            </a>
            <video src={state.videoUrl} controls className="w-full rounded-lg" />
          </div>
        )}
      </main>
      <PageNav back={{ label: 'Recording', href: '/record' }} />
    </div>
  );
}
