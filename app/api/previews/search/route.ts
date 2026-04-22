import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export type PreviewStatus = "pending" | "complete" | "incomplete";

export type PreviewMerchant = {
  id: string;
  brandName: string;
  websiteUrl: string;
  activityAt: string;
  wasEdited: boolean;
  status: PreviewStatus;
};

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 30;
const RECENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// The iframe brand target rejects URLs with http(s):// — strip before returning.
function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_LIMIT)
    : DEFAULT_LIMIT;

  let query = supabase
    .from("previews")
    .select("id, website_url, data, created_at, last_edited_at, enhancement_complete")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.ilike("website_url", pattern);
  } else {
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    website_url: string;
    data: Record<string, unknown> | null;
    created_at: string;
    last_edited_at: string | null;
    enhancement_complete: boolean | null;
  }>;
  const results: PreviewMerchant[] = rows.map((r) => {
    const websiteUrl = stripProtocol(r.website_url);
    const wasEdited = !!r.last_edited_at;
    const featuredCount = Array.isArray(r.data?.featuredProducts) ? r.data.featuredProducts.length : 0;
    const status: PreviewStatus = !r.enhancement_complete
      ? "pending"
      : featuredCount >= 3
        ? "complete"
        : "incomplete";
    return {
      id: r.id,
      websiteUrl,
      brandName: typeof r.data?.brandName === "string" ? (r.data.brandName as string) : websiteUrl,
      activityAt: r.last_edited_at ?? r.created_at,
      wasEdited,
      status,
    };
  });

  return NextResponse.json({ results });
}
