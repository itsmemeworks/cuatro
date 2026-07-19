import { NextResponse } from "next/server";
import { AASA_DOCUMENT } from "@/lib/aasa";

/**
 * iOS tries this well-known path first when validating universal links.
 * Must be a direct 200 application/json response: no redirect, no auth,
 * no HTML wrapper. Body is byte-identical to /apple-app-site-association
 * (both read the same AASA_DOCUMENT constant).
 */
export async function GET() {
  return NextResponse.json(AASA_DOCUMENT, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
