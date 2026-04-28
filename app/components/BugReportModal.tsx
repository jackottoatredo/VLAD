"use client";

import { useState } from "react";

type Props = {
  onClose: () => void;
};

export default function BugReportModal({ onClose }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = text.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Report a bug</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-foreground"
          >
            ×
          </button>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe what went wrong…"
          rows={6}
          className="block w-full resize-y rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-inner outline-none focus:border-gray-400 dark:focus:border-gray-500"
        />

        {error && (
          <p className="mt-2 text-xs text-red-500">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <a
            href="https://redo-tech.slack.com/archives/C0AU9L8FHNJ/p1776788407647019"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            bugs are posted to <span className="underline">this thread</span>
          </a>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
