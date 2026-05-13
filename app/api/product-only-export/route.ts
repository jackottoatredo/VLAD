import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { produceProductOnly } from "@/lib/render/produce-product-only";
import {
  type SectionFormSettings,
  type Webcam,
} from "@/lib/render/spec";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestBody = {
  productRecordingId?: unknown;
  merchantBrand?: unknown;
  /** Optional resolved form settings from the modal — when omitted the
   *  recording's metadata is used directly (legacy default). */
  productSettings?: unknown;
  /** Admin-only: render on behalf of another user. */
  targetUserId?: unknown;
};

type MerchantBrand = {
  websiteUrl: string;
  brandName: string;
};

function parseMerchantBrand(v: unknown): MerchantBrand | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.websiteUrl !== "string" || !o.websiteUrl.trim()) return null;
  if (typeof o.brandName !== "string") return null;
  return { websiteUrl: o.websiteUrl.trim(), brandName: o.brandName };
}

function parseSectionForm(v: unknown): SectionFormSettings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const isSource = (s: unknown): s is SectionFormSettings["modeSource"] =>
    s === "self" || s === "other" || s === "custom";
  const isMode = (m: unknown): m is Webcam["mode"] => m === "video" || m === "audio" || m === "off";
  const isVert = (v: unknown): v is "top" | "bottom" => v === "top" || v === "bottom";
  const isHorz = (h: unknown): h is "left" | "right" => h === "left" || h === "right";

  if (!isSource(o.modeSource) || !isSource(o.positionSource)) return null;
  if (!isMode(o.customMode)) return null;
  const cp = o.customPosition as Record<string, unknown> | undefined;
  if (!cp || !isVert(cp.vertical) || !isHorz(cp.horizontal)) return null;

  return {
    modeSource: o.modeSource,
    customMode: o.customMode,
    positionSource: o.positionSource,
    customPosition: { vertical: cp.vertical, horizontal: cp.horizontal },
  };
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const productRecordingId = typeof body.productRecordingId === "string" ? body.productRecordingId.trim() : "";
  if (!UUID_RE.test(productRecordingId)) {
    return NextResponse.json({ error: "Missing or invalid productRecordingId." }, { status: 400 });
  }

  const merchant = parseMerchantBrand(body.merchantBrand);
  if (!merchant) {
    return NextResponse.json({ error: "Missing or invalid merchantBrand." }, { status: 400 });
  }

  const productForm = parseSectionForm(body.productSettings);

  // Admin override: admins may render on behalf of another user. Permission
  // (the userId must own the target recording) is enforced inside the helper,
  // so an admin can't grab another user's recording into their own account.
  const userId =
    session.role === "admin" && typeof body.targetUserId === "string" && body.targetUserId
      ? body.targetUserId
      : session.email;

  const outcome = await produceProductOnly({
    userId,
    productRecordingId,
    merchantBrand: merchant,
    productSettings: productForm,
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
