import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { UnsupportedFileError, detectTable, extractTables } from "@/lib/supplier-files";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 5000;

// Reads an uploaded supplier price list and returns its tables with the guessed columns, for the preview.
export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choisissez un fichier." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Fichier trop volumineux (20 Mo maximum)." }, { status: 400 });
  try {
    const tables = await extractTables(Buffer.from(await file.arrayBuffer()), file.name);
    if (!tables.length) return NextResponse.json({ error: "Aucun tableau ni ligne de prix trouvé dans ce fichier." }, { status: 422 });
    return NextResponse.json({
      fileName: file.name,
      tables: tables.map((t) => detectTable({ ...t, rows: t.rows.slice(0, MAX_ROWS) })),
    });
  } catch (e) {
    const message = e instanceof UnsupportedFileError ? e.message : "Lecture du fichier impossible : il est peut-être protégé ou endommagé.";
    if (!(e instanceof UnsupportedFileError)) console.error("[purchasing/parse]", e);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
