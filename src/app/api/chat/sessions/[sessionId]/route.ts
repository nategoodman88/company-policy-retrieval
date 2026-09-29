import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { sessionId } = await context.params;
  const supabase = getSupabaseAdmin();
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: "Could not load conversation." }, { status: 503 });
  if (!session) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, citations, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load messages." }, { status: 503 });
  return NextResponse.json({ messages });
}