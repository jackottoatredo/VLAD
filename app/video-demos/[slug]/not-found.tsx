export default function ShareNotFound() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-8 text-center shadow-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          This share link isn’t available
        </h1>
        <p className="text-sm text-muted">
          The demo you’re looking for may have been removed or the link may be
          incorrect. Please contact the sender for an updated link.
        </p>
      </div>
    </main>
  );
}
