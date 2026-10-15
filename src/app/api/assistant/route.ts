import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { answerAssistant } from "@/lib/assistant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = String(body.question ?? "").slice(0, 2000);
  const answer = await answerAssistant(auth, question);
  return NextResponse.json({ answer });
}
