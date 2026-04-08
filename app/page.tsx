import Preview from "./components/Preview";
import Settings from "./components/Settings";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-4xl space-y-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-zinc-950 sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Video Language Automated Demo (VLAD)
        </h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Enter a URL and create a 1-second MP4 with cursor motion.
        </p>
        <Settings />
        <Preview />
      </main>
    </div>
  );
}
