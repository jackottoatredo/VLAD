import PageNav from "@/app/components/PageNav";

function SpinnerPanel() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-black/10 bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 aspect-video w-full">
      <svg
        className="h-8 w-8 animate-spin text-zinc-400 dark:text-zinc-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-zinc-50 px-6 py-8 font-sans dark:bg-black">
      <main className="w-full max-w-5xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Product Preview
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Four renderings of the product recording, each with a unique URL.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <SpinnerPanel />
          <SpinnerPanel />
          <SpinnerPanel />
          <SpinnerPanel />
        </div>
      </main>
      <PageNav back={{ label: "Product Recording", href: "/record" }} forward={{ label: "Merchant Customization", href: "/merchant" }} />
    </div>
  );
}
