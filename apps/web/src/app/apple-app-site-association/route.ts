import { NextResponse } from "next/server";
import { AASA_DOCUMENT } from "@/lib/aasa";

/**
 * Fallback path iOS tries if /.well-known/apple-app-site-association isn't
 * found. Must stay byte-identical to that route — see @/lib/aasa.
 */
export async function GET() {
  return NextResponse.json(AASA_DOCUMENT, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
