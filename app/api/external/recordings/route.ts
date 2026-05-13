import { NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/apiAuth";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const RECORDING_FIELDS =
  "id, type, name, product_name, merchant_id, merchant_name, preview_url, status, created_at, updated_at";

type RecordingRow = {
  id: string;
  type: "product" | "merchant";
  name: string;
  product_name: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  preview_url: string | null;
  status: "draft" | "saved";
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  if (!requireBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Missing email." }, { status: 400 });
  }

  const type = searchParams.get("type");
  if (type && type !== "product" && type !== "merchant") {
    return NextResponse.json({ error: "Invalid type." }, { status: 400 });
  }

  let query = supabase
    .from("vlad_recordings")
    .select(RECORDING_FIELDS)
    .eq("user_id", email)
    .order("updated_at", { ascending: false });

  if (type) query = query.eq("type", type);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recordings = ((data ?? []) as RecordingRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    productName: r.product_name,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    previewUrl: r.preview_url,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ recordings });
}
