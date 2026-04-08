"use client";

import { useAppContext } from "../appContext";

export default function Preview() {
  const { errorMessage, videoUrl } = useAppContext();

  return (
    <section className="space-y-4">
      {errorMessage ? <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p> : null}

      {videoUrl ? (
        <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Recording saved at:
            <a
              href={videoUrl}
              className="ml-1 font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              {videoUrl}
            </a>
          </p>

          <a
            href={videoUrl}
            download
            className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Download MP4
          </a>

          <video src={videoUrl} controls className="w-full rounded-lg" />
        </div>
      ) : null}
    </section>
  );
}
