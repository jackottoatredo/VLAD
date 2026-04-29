import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/db/supabase";
import { INTERACTIVE_DEMO_BASE_URL } from "@/app/config";
import { findProductLabel } from "@/lib/products";
import ShareActions from "./ShareActions";

export const runtime = "nodejs";

// Override the site-level description from app/layout.tsx, which is internal
// product copy ("Video Language Automated Demo recording interface.") and
// shouldn't appear in unfurls of public share pages.
const SHARE_DESCRIPTION = "REDO preview made just for you";

type ShareRow = {
  brand: string | null;
  brand_name: string | null;
  slug: string;
  video_url: string | null;
  poster_key: string | null;
  poster_square_key: string | null;
  gif_key: string | null;
  brand_url: string | null;
  product_name: string | null;
};

// Memoize per-request so generateMetadata + the page body share one DB call.
const fetchShareRow = cache(async (slug: string): Promise<ShareRow | null> => {
  const { data, error } = await supabase
    .from("vlad_renders")
    .select("brand, brand_name, slug, video_url, poster_key, poster_square_key, gif_key, brand_url, product_name")
    .eq("slug", slug)
    .single();
  if (error || !data) return null;
  return data as ShareRow;
});

// "mammut.com" → "Mammut", "and-collar.com" → "And Collar"
function brandNameFromUrl(brandUrl: string): string {
  const root = brandUrl.split(".")[0] ?? brandUrl;
  if (!root) return brandUrl;
  return root
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Strip anything that could form an HTML tag or entity. previews.data.brandName
// is sourced from external scrapes; defensively sanitize before it lands in
// document <title>, og/twitter meta, or JSX text.
function sanitizeBrandName(s: string): string {
  return s.replace(/[<>&"']/g, "").trim();
}

function deriveTitleParts(row: ShareRow): {
  brandName: string | null;
  productLabel: string | null;
} {
  // Prefer the human brand name from previews.data; fall back to the URL
  // derivation for old rows that pre-date the brand_name column.
  const rawBrandName =
    row.brand_name?.trim() ||
    (row.brand_url ? brandNameFromUrl(row.brand_url) : null);
  const brandName = rawBrandName ? sanitizeBrandName(rawBrandName) || null : null;
  const safeProduct = row.product_name?.trim() || null;
  // Fall back to the raw safe form if the catalog has drifted from old rows.
  const productLabel = safeProduct ? findProductLabel(safeProduct) ?? safeProduct : null;
  return { brandName, productLabel };
}

function buildShareTitle(row: ShareRow): string {
  const { brandName, productLabel } = deriveTitleParts(row);
  if (brandName && productLabel) {
    return `Hey ${brandName}, see what REDO ${productLabel} can do for you`;
  }
  return row.brand ?? "Demo";
}

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
  const title = buildShareTitle(row);
  const url = `${baseUrl}/v/${slug}`;
  // og:image is the no-webcam render's first frame at native 16:9, zoomed
  // in to hide the rounded white border. Older rows without poster_square_key
  // fall back to the with-webcam poster (also 16:9, native dims).
  const ogImageEntry: { url: string; type: string; width: number; height: number } | null =
    row.poster_square_key
      ? {
          url: `${baseUrl}/v/${slug}/poster_square.jpg`,
          type: "image/jpeg",
          width: 1920,
          height: 1080,
        }
      : row.poster_key
        ? {
            url: `${baseUrl}/v/${slug}/poster.jpg`,
            type: "image/jpeg",
            width: 1920,
            height: 1080,
          }
        : null;

  return {
    title,
    description: SHARE_DESCRIPTION,
    openGraph: {
      title,
      description: SHARE_DESCRIPTION,
      url,
      type: "website",
      images: ogImageEntry ? [ogImageEntry] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: SHARE_DESCRIPTION,
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

  const { brandName, productLabel } = deriveTitleParts(row);
  const fallbackTitle = buildShareTitle(row);
  const videoSrc = `/v/${slug}/video.mp4`;
  const posterSrc = row.poster_key ? `/v/${slug}/poster.jpg` : undefined;
  const downloadHref = `/v/${slug}/download`;

  const interactiveDemoUrl = row.brand_url
    ? `${INTERACTIVE_DEMO_BASE_URL}${row.brand_url}` +
      (row.product_name?.trim()
        ? `?product=${encodeURIComponent(row.product_name)}`
        : "")
    : null;

  return (
    <main className="force-light share-fill-on-landscape flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="share-wrapper-on-landscape w-full max-w-6xl lg:max-w-[60vw]">
        {brandName && productLabel ? (
          <header className="share-hide-on-landscape mb-5 text-center">
            <h1 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
              Hey {brandName},
            </h1>
            <p className="mt-1 text-lg text-foreground sm:text-xl">
              see what <strong className="font-semibold">REDO</strong> {productLabel} can do for{" "}
              <strong className="font-semibold">you</strong>
            </p>
          </header>
        ) : (
          <h1 className="share-hide-on-landscape mb-5 text-center text-2xl font-semibold text-foreground">{fallbackTitle}</h1>
        )}
        <div className="share-frame-on-landscape overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
          <video
            src={videoSrc}
            poster={posterSrc}
            controls
            playsInline
            className="share-video-on-landscape aspect-video w-full bg-background"
          />
        </div>
        <div className="share-hide-on-landscape">
          <ShareActions slug={slug} downloadHref={downloadHref} interactiveDemoUrl={interactiveDemoUrl} />
        </div>
      </div>
    </main>
  );
}
