import { NextResponse } from "next/server";
import { getAuth, isPurchasingOnly } from "@/lib/auth";
import { answerAssistant } from "@/lib/assistant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth || isPurchasingOnly(auth.user.role)) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = String(body.question ?? "").slice(0, 2000);
  const answer = await answerAssistant(auth, question);
  return NextResponse.json({ answer });
}
