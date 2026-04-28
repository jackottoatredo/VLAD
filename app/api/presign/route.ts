import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { getPresignedUrl } from "@/lib/storage/r2";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }

  try {
    const url = await getPresignedUrl(key, 604800); // 7 day expiry (R2 max)
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Presign failed for key:", key, err);
    return NextResponse.json({ error: "Failed to generate presigned URL." }, { status: 500 });
  }
}
