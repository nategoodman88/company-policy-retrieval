import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Could not load chat sessions:", error);
    return NextResponse.json({ error: "Could not load chat history." }, { status: 503 });
  }
  return NextResponse.json({ sessions: data });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("chat_sessions")
    .insert({ user_id: user.id, title: "New conversation" })
    .select("id, title, updated_at")
    .single();

  if (error) {
    console.error("Could not create chat session:", error);
    return NextResponse.json({ error: "Could not create a conversation." }, { status: 503 });
  }
  return NextResponse.json({ session: data }, { status: 201 });
}