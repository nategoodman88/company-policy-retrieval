import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const sessionUser = await getRequestUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: user, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, email")
    .eq("id", sessionUser.id)
    .maybeSingle();

  if (error) {
    console.error("Could not load current user:", error);
    return NextResponse.json({ error: "Could not load account details." }, { status: 503 });
  }
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({ user });
}