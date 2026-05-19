import { createHash } from "node:crypto";
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

const CHOMP_SCRAPE_CONFIG = {
  scraperBackend: "api",
  apiProvider: "firecrawl",
  apiScrapeMode: "full",
  firecrawlScreenshot: true,
  firecrawlScreenshotMode: "parallel",
  colorExtractionMode: "firecrawl",
  useLLM: true,
  useOCR: true,
  useHeroScoring: true,
  heroScoringMethod: "sharp-vision",
  rerunStep2IfNoProducts: true,
  useStoreleads: true,
  blockResources: true,
  skipMode: "none",
  useAmazon: false,
  useCache: true,
  endStep: 3,
  debug: false,
  maxProducts: 250,
  maxProductPages: 1,
  pageLoadTimeout: 60,
  extractorTimeout: 60,
  jobTimeout: 120000,
} as const;

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

export async function POST(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { domain?: unknown };
  try {
    body = (await request.json()) as { domain?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawDomain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!rawDomain) {
    return NextResponse.json({ error: "Missing domain." }, { status: 400 });
  }
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes(".")) {
    return NextResponse.json({ error: "Invalid domain." }, { status: 400 });
  }

  const chompUrl = process.env.CHOMP_API_URL?.replace(/\/+$/, "");
  const chompKey = process.env.CHOMP_API_KEY_PUBLIC ?? process.env.CHOMP_API_KEY;
  if (!chompUrl || !chompKey) {
    return NextResponse.json(
      { error: "Scraper not configured." },
      { status: 503 },
    );
  }

  const payload = { url: `https://${domain}`, ...CHOMP_SCRAPE_CONFIG };
  const payloadJson = JSON.stringify(payload);
  const idempotencyKey = createHash("sha256").update(payloadJson).digest("hex");

  let chompResponse: Response;
  try {
    chompResponse = await fetch(`${chompUrl}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chompKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: payloadJson,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to reach scraper: ${message}` },
      { status: 502 },
    );
  }

  const chompJson = (await chompResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!chompResponse.ok) {
    return NextResponse.json(
      { error: "Scraper error", chomp: chompJson },
      { status: chompResponse.status },
    );
  }

  return NextResponse.json(
    {
      status: "pending" as const,
      domain,
      chomp: chompJson,
    },
    { status: 202 },
  );
}
