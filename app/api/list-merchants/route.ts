import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";

export const runtime = "nodejs";

export type Merchant = {
  id: string;
  name: string;
  url: string;
};

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("vlad_merchants")
    .select("id, name, url")
    .order("name");

  if (error) {
    return NextResponse.json({ merchants: [] });
  }

  return NextResponse.json({ merchants: data as Merchant[] });
}
