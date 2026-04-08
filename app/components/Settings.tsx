"use client";

import { FormEvent } from "react";
import { useAppContext } from "../appContext";

export default function Settings() {
  const { url, width, height, fps, setUrl, setWidth, setHeight, setFps, record, isRecording } =
    useAppContext();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await record();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          className="h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          required
        />
        <button
          type="submit"
          disabled={isRecording}
          className="h-12 shrink-0 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isRecording ? "Recording..." : "Record"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Width
          <input
            type="number"
            min={320}
            max={3840}
            value={width}
            onChange={(event) => setWidth(event.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Height
          <input
            type="number"
            min={240}
            max={2160}
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          FPS
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(event) => setFps(event.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </label>
      </div>
    </form>
  );
}
