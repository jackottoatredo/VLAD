import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const MERCHANTS_PATH = path.join(process.cwd(), "public", "merchants.json");

export type Merchant = {
  id: string;
  name: string;
  url: string;
};

export async function GET() {
  try {
    const raw = await readFile(MERCHANTS_PATH, "utf-8");
    const merchants = JSON.parse(raw) as Merchant[];
    return NextResponse.json({ merchants });
  } catch {
    return NextResponse.json({ merchants: [] });
  }
}
