import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const MERCHANTS_PATH = path.join(process.cwd(), "public", "merchants.json");
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

type Merchant = {
  id: string;
  name: string;
  url: string;
};

/** Strip protocol, remove dots/slashes, collapse to a safe slug. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { name, url } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing merchant name." }, { status: 400 });
  }
  if (typeof url !== "string" || !DOMAIN_PATTERN.test(url.trim())) {
    return NextResponse.json({ error: "Invalid domain. Enter something like mammut.com." }, { status: 400 });
  }

  const id = toSlug(name.trim());
  if (!id) {
    return NextResponse.json({ error: "Name produces an empty identifier." }, { status: 400 });
  }

  let merchants: Merchant[] = [];
  try {
    merchants = JSON.parse(await readFile(MERCHANTS_PATH, "utf-8")) as Merchant[];
  } catch {}

  if (merchants.some((m) => m.id === id)) {
    return NextResponse.json({ error: "A merchant with that name already exists." }, { status: 409 });
  }

  const merchant: Merchant = { id, name: name.trim(), url: url.trim() };
  merchants.push(merchant);
  merchants.sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(MERCHANTS_PATH, JSON.stringify(merchants, null, 2), "utf-8");

  return NextResponse.json({ ok: true, merchant });
}
