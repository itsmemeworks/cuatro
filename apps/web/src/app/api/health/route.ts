import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import pkg from "../../../../package.json" with { type: "json" };

// Fly runs this every 15s. It must reflect real liveness, so it does an actual
// DB round-trip (not just "the process answered") — but stay cheap: reuse the
// process-wide singleton connection (never open one per hit) and bound the
// probe so a hung database returns 503 fast instead of piling up requests.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("db_timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function GET() {
  let dbOk = false;
  try {
    // getDb() is the singleton (first call boots + migrates); the timeout covers
    // both acquiring it and the SELECT 1 so neither can hang the probe.
    await withTimeout(
      (async () => {
        const { db } = await getDb();
        await db.execute(sql`select 1`);
      })(),
      DB_TIMEOUT_MS,
    );
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json(
    { ok: dbOk, version: pkg.version, db: dbOk ? "ok" : "error" },
    { status: dbOk ? 200 : 503 },
  );
}
