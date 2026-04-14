import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

export type Merchant = {
  id: string;
  name: string;
  url: string;
};

export async function GET() {
  const { data, error } = await supabase
    .from("vlad_merchants")
    .select("id, name, url")
    .order("name");

  if (error) {
    return NextResponse.json({ merchants: [] });
  }

  return NextResponse.json({ merchants: data as Merchant[] });
}
