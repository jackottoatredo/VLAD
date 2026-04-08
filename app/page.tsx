import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Welcome to VLAD
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Video and Language Automations for Demos
          </p>
        </div>
        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            VLAD lets you record real mouse interactions on a target site and replay them
            as a smooth, programmatically generated demo video.
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <Link href="/record" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Record</Link>
              {" — "}load the target site in the iframe, name your session, and capture mouse events.
            </li>
            <li>
              <Link href="/render" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Render</Link>
              {" — "}replay a recorded session through Puppeteer and export it as an MP4.
            </li>
          </ol>
        </div>
      </main>
    </div>
  )
}
