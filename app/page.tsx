import Link from "next/link";
import PageNav from "@/app/components/PageNav";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Welcome to VLAD
          </h1>
          <h3 className="mt-1 text-zinc-500 dark:text-zinc-400">
            Video and Language Automations for Demos
          </h3>
        </div>
        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            VLAD lets you record real mouse interactions on a target site and replay them
            as a smooth, programmatically generated demo video — reusing the same webcam
            recording across multiple unique product URLs.
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <Link href="/record" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Product Flow</Link>
              {" — "}record mouse interactions, trim, preview across brands, and save to library.
            </li>
            <li>
              <Link href="/merchant" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Merchant Flow</Link>
              {" — "}record a merchant-specific intro, trim, and save to library.
            </li>
            <li>
              <Link href="/review" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Final Rendering</Link>
              {" — "}combine a saved product recording with a saved merchant recording into a final video. <span className="text-zinc-400">(Coming soon)</span>
            </li>
          </ol>
        </div>
      </main>
      <PageNav forward={{ label: 'Recording', href: '/record' }} />
    </div>
  )
}
