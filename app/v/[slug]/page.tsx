import { notFound } from "next/navigation";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

type ShareRow = {
  brand: string | null;
  slug: string;
  video_url: string | null;
  poster_key: string | null;
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data, error } = await supabase
    .from("vlad_renders")
    .select("brand, slug, video_url, poster_key")
    .eq("slug", slug)
    .single();

  const row = data as ShareRow | null;
  if (error || !row || !row.video_url) notFound();

  const title = row.brand ?? "Demo";
  const videoSrc = `/v/${slug}/video.mp4`;
  const posterSrc = row.poster_key ? `/v/${slug}/poster.jpg` : undefined;
  const downloadHref = `/v/${slug}/download`;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <h1 className="mb-4 text-center text-2xl font-semibold text-foreground">{title}</h1>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
          <video
            src={videoSrc}
            poster={posterSrc}
            controls
            playsInline
            className="aspect-video w-full bg-background"
          />
        </div>
        <div className="mt-4 flex justify-center">
          <a
            href={downloadHref}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-80"
          >
            Download video
          </a>
        </div>
      </div>
    </main>
  );
}
