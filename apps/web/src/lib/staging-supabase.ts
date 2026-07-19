import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A DELIBERATELY separate Supabase client for resolving opaque share links
 * (/s/[token]). The native app's share-link backend lives on the STAGING
 * Supabase project regardless of which website environment serves this
 * page (prod website + staging backend, confirmed — the beta app is wired
 * to staging for now). This must never be confused with
 * @/lib/supabase/server's client, which is build-time-baked per Fly app via
 * NEXT_PUBLIC_SUPABASE_URL/ANON_KEY and points at THAT env's own project.
 *
 * Anon/publishable key only — this key is already public (committed in
 * fly.staging.toml) and can only ever call anon-grantable RPCs (like
 * resolve_share_link, a SECURITY DEFINER function that locks down the
 * underlying tables itself). Never the service-role key.
 */
const SHARE_LINK_SUPABASE_URL = process.env.CUATRO_SUPABASE_URL || "https://cmqicxumhmthbuoehoju.supabase.co";
const SHARE_LINK_SUPABASE_KEY =
  process.env.CUATRO_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtcWljeHVtaG10aGJ1b2Vob2p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTkxMDksImV4cCI6MjA5OTI3NTEwOX0.nJUasMQtYA4QzP10Q3lCAjNVAQcpUMZT6gJOuhela0E";

let cachedClient: ReturnType<typeof createSupabaseClient> | null = null;

export function getShareLinkSupabase() {
  if (!cachedClient) {
    cachedClient = createSupabaseClient(SHARE_LINK_SUPABASE_URL, SHARE_LINK_SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
  return cachedClient;
}
