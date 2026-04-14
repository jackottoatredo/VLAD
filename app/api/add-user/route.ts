import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const USERS_DIR = path.join(process.cwd(), "public", "users");
const NAME_PART = /^[a-zA-Z]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { firstName, lastName } = body as Record<string, unknown>;

  if (typeof firstName !== "string" || !NAME_PART.test(firstName)) {
    return NextResponse.json({ error: "Invalid first name." }, { status: 400 });
  }
  if (typeof lastName !== "string" || !NAME_PART.test(lastName)) {
    return NextResponse.json({ error: "Invalid last name." }, { status: 400 });
  }

  const userId = `${lastName.toLowerCase()}_${firstName.toLowerCase()}`;

  const { error } = await supabase.from("vlad_users").insert({
    id: userId,
    first_name: firstName.toLowerCase(),
    last_name: lastName.toLowerCase(),
  });

  if (error) {
    if (error.code === "23505") {
      // User already exists — not an error, just ensure the local dir exists
    } else {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Keep local directory for draft recordings
  await mkdir(path.join(USERS_DIR, userId), { recursive: true });

  return NextResponse.json({ ok: true, userId });
}
