import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";
import { r2Client } from "@/lib/storage/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const filename = searchParams.get("filename");

  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }

  try {
    const res = await r2Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
      })
    );

    const stream = res.Body as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": res.ContentType ?? "video/mp4",
      "Content-Length": res.ContentLength?.toString() ?? "",
      "Cache-Control": "private, max-age=86400",
    };
    if (filename) {
      headers["Content-Disposition"] = `attachment; filename="${filename}.mp4"`;
    }
    return new Response(stream as unknown as BodyInit, { headers });
  } catch (err) {
    console.error("Stream failed for key:", key, err);
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
