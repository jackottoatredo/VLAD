import { NextResponse } from "next/server";
import { promises as dns } from "dns";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

const TIMEOUT_MS = 3000;

function extractHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const noProtocol = trimmed.replace(/^https?:\/\//, "");
  const host = noProtocol.split("/")[0];
  return host || null;
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const host = extractHost(url);
  if (!host) return NextResponse.json({ resolved: false });

  try {
    await Promise.race([
      dns.lookup(host),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns-timeout")), TIMEOUT_MS),
      ),
    ]);
    return NextResponse.json({ resolved: true });
  } catch {
    return NextResponse.json({ resolved: false });
  }
}
