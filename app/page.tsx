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
              <Link href="/record" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Product Recording</Link>
              {" — "}load the target site in the iframe and capture your mouse interactions with webcam overlay.
            </li>
            <li>
              <Link href="/preview" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Product Preview</Link>
              {" — "}review four rendered versions of your recording, each driven by a unique URL.
            </li>
            <li>
              <Link href="/merchant" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Merchant Customization</Link>
              {" — "}record a short intro that will be prepended to the final product video.
            </li>
            <li>
              <Link href="/review" className="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200">Review & Export</Link>
              {" — "}combine the merchant intro with the product recording and download the final MP4.
            </li>
          </ol>
        </div>
      </main>
      <PageNav forward={{ label: 'Recording', href: '/record' }} />
    </div>
  )
}
