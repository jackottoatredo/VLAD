import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export type ScrapeStatus = "complete" | "pending" | "incomplete" | "not_scraped";

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .split("/")[0];
}

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawDomain = searchParams.get("domain")?.trim() ?? "";
  if (!rawDomain) {
    return NextResponse.json({ error: "Missing domain." }, { status: 400 });
  }

  const domain = normalizeDomain(rawDomain);

  const { data, error } = await supabase
    .from("previews")
    .select(
      "id, website_url, data, enhancement_complete, last_edited_at, created_at",
    )
    .ilike("website_url", `%${domain}%`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    website_url: string;
    data: Record<string, unknown> | null;
    enhancement_complete: boolean | null;
    last_edited_at: string | null;
    created_at: string;
  };

  const rows = (data ?? []) as Row[];
  // ilike '%domain%' may include super-strings (e.g. mammut.com matches
  // mammut.com.au). Require exact normalized match.
  const exact = rows.find((r) => normalizeDomain(r.website_url) === domain);

  if (!exact) {
    return NextResponse.json({ status: "not_scraped", merchant: null });
  }

  const featuredCount = Array.isArray(exact.data?.featuredProducts)
    ? (exact.data.featuredProducts as unknown[]).length
    : 0;
  const status: ScrapeStatus = !exact.enhancement_complete
    ? "pending"
    : featuredCount >= 3
      ? "complete"
      : "incomplete";

  const brandName =
    typeof exact.data?.brandName === "string"
      ? (exact.data.brandName as string)
      : domain;

  return NextResponse.json({
    status,
    merchant: {
      id: exact.id,
      brandName,
      websiteUrl: normalizeDomain(exact.website_url),
      activityAt: exact.last_edited_at ?? exact.created_at,
      featuredProductCount: featuredCount,
    },
  });
}
