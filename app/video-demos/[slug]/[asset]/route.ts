import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { getPresignedUrl, headR2Object } from "@/lib/storage/r2";
import { logEngagementEvent } from "@/lib/stats/engagement";

export const runtime = "nodejs";

const ASSET_TTL_SECONDS = 60 * 60;
const REDIRECT_CACHE_SECONDS = 300;

type ShareRow = {
  video_url: string | null;
  poster_key: string | null;
  poster_square_key: string | null;
  gif_key: string | null;
};

type Resolved = { key: string; contentType: string; contentDisposition?: string };

// Downloaded filenames use the slug (already kebab-case + globally unique) so
// recipients never get colliding filenames locally.
function resolveAsset(asset: string, row: ShareRow, slug: string): Resolved | null {
  switch (asset) {
    case "video.mp4":
      return row.video_url ? { key: row.video_url, contentType: "video/mp4" } : null;
    case "poster.jpg":
      return row.poster_key ? { key: row.poster_key, contentType: "image/jpeg" } : null;
    case "poster_square.jpg":
      return row.poster_square_key ? { key: row.poster_square_key, contentType: "image/jpeg" } : null;
    case "preview.gif":
      return row.gif_key ? { key: row.gif_key, contentType: "image/gif" } : null;
    case "download": {
      if (!row.video_url) return null;
      return {
        key: row.video_url,
        contentType: "video/mp4",
        contentDisposition: `attachment; filename="${slug}.mp4"`,
      };
    }
    case "download-gif": {
      if (!row.gif_key) return null;
      return {
        key: row.gif_key,
        contentType: "image/gif",
        contentDisposition: `attachment; filename="${slug}.gif"`,
      };
    }
    case "download-poster": {
      if (!row.poster_key) return null;
      return {
        key: row.poster_key,
        contentType: "image/jpeg",
        contentDisposition: `attachment; filename="${slug}.jpg"`,
      };
    }
    default:
      return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; asset: string }> },
) {
  const { slug, asset } = await params;

  const { data, error } = await supabase
    .from("vlad_renders")
    .select("video_url, poster_key, poster_square_key, gif_key")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const resolved = resolveAsset(asset, data as ShareRow, slug);
  if (!resolved) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Guard against the race between status="done" and R2 object availability.
  // The worker now validates artifacts before finalize (see
  // validateRenderArtifacts in worker.ts), but a HEAD here protects against
  // any drift, manual DB edits, or in-flight cache rows from before the
  // validation existed. Distinguishes:
  //   - key missing entirely → 404 (no retry)
  //   - key present but 0 bytes → 425 Too Early (client may retry)
  const head = await headR2Object(resolved.key);
  if (!head) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (head.contentLength <= 0) {
    return new NextResponse("Asset not ready", {
      status: 425,
      headers: { "Cache-Control": "no-store", "Retry-After": "2" },
    });
  }

  // Log only the click-equivalent assets. video.mp4/poster.jpg/preview.gif
  // fire on every browser load and would drown the signal.
  if (asset === "download" || asset === "download-gif" || asset === "download-poster") {
    void logEngagementEvent({
      type: "asset_download",
      slug,
      headers: request.headers,
      payload: { asset },
    });
  }

  const presigned = await getPresignedUrl(resolved.key, ASSET_TTL_SECONDS, {
    contentType: resolved.contentType,
    contentDisposition: resolved.contentDisposition,
  });

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: presigned,
      "Cache-Control": `public, max-age=${REDIRECT_CACHE_SECONDS}`,
    },
  });
}
