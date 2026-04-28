import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

type ShareRow = {
  brand: string | null;
  slug: string;
  video_url: string | null;
  poster_key: string | null;
  poster_square_key: string | null;
  gif_key: string | null;
};

// Memoize per-request so generateMetadata + the page body share one DB call.
const fetchShareRow = cache(async (slug: string): Promise<ShareRow | null> => {
  const { data, error } = await supabase
    .from("vlad_renders")
    .select("brand, slug, video_url, poster_key, poster_square_key, gif_key")
    .eq("slug", slug)
    .single();
  if (error || !data) return null;
  return data as ShareRow;
});

async function resolveBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const row = await fetchShareRow(slug);
  if (!row) return { title: "Not Found" };

  const baseUrl = await resolveBaseUrl();
  const title = row.brand ?? "Demo";
  const url = `${baseUrl}/v/${slug}`;
  // Square 1200x1200 poster works in every preview card (iMessage, WhatsApp,
  // Slack, Twitter/X, LinkedIn, Discord) without center-crop artifacts. Pre-
  // square rows fall back to the 16:9 poster, which still beats no preview.
  const ogImageEntry: { url: string; type: string; width: number; height: number } | null =
    row.poster_square_key
      ? {
          url: `${baseUrl}/v/${slug}/poster_square.jpg`,
          type: "image/jpeg",
          width: 1200,
          height: 1200,
        }
      : row.poster_key
        ? {
            url: `${baseUrl}/v/${slug}/poster.jpg`,
            type: "image/jpeg",
            width: 480,
            height: 270,
          }
        : null;

  return {
    title,
    openGraph: {
      title,
      url,
      type: "website",
      images: ogImageEntry ? [ogImageEntry] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: ogImageEntry ? [ogImageEntry.url] : [],
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const row = await fetchShareRow(slug);
  if (!row || !row.video_url) notFound();

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
