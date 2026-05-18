import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { produceProductOnly } from "@/lib/render/produce-product-only";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestBody = {
  /** Email of the VLAD user that will own the resulting render row. */
  userId?: unknown;
  productRecordingId?: unknown;
  merchantBrand?: unknown;
  /** If true, skip the render cache and always enqueue a fresh job. */
  force?: unknown;
};

type MerchantBrand = { websiteUrl: string; brandName: string };

function parseMerchantBrand(v: unknown): MerchantBrand | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.websiteUrl !== "string" || !o.websiteUrl.trim()) return null;
  if (typeof o.brandName !== "string") return null;
  return { websiteUrl: o.websiteUrl.trim(), brandName: o.brandName };
}

export async function POST(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim().toLowerCase() : "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId." }, { status: 400 });
  }

  const productRecordingId =
    typeof body.productRecordingId === "string" ? body.productRecordingId.trim() : "";
  if (!UUID_RE.test(productRecordingId)) {
    return NextResponse.json(
      { error: "Missing or invalid productRecordingId." },
      { status: 400 },
    );
  }

  const merchant = parseMerchantBrand(body.merchantBrand);
  if (!merchant) {
    return NextResponse.json(
      { error: "Missing or invalid merchantBrand." },
      { status: 400 },
    );
  }

  const outcome = await produceProductOnly({
    userId,
    productRecordingId,
    merchantBrand: merchant,
    productSettings: null,
    force: body.force === true,
    jobRequestBody: body,
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  }

  if (outcome.result.kind === "cached") {
    return NextResponse.json({
      cached: true,
      renderId: outcome.result.renderId,
      videoR2Key: outcome.result.videoR2Key,
      slug: outcome.result.slug,
    });
  }

  return NextResponse.json({
    jobId: outcome.result.jobId,
    renderId: outcome.result.renderId,
    slug: outcome.result.slug,
  });
}
