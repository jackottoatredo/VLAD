import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

type Merchant = {
  id: string;
  name: string;
  url: string;
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

  const merchant: Merchant = { id, name: name.trim(), url: url.trim() };

  const { error } = await supabase.from("vlad_merchants").insert(merchant);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A merchant with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, merchant });
}
