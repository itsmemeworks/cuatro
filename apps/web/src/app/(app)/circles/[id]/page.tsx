import { getSessionUser } from "@/lib/session";
import { loadCircleContext } from "./load-circle";
import { CirclePhone } from "@/components/circle-screens/circle-phone";

/** Tabs the phone CircleTabs understands — the `?tab=` deep link (e.g. a circle-knock notification landing the organiser on Settings) is validated against this before it's threaded through. */
const CIRCLE_TABS = ["feed", "chat", "members", "settings"] as const;
type CircleTab = (typeof CIRCLE_TABS)[number];

/**
 * Circle context, base route = the Feed (WEB-SHELL-SPEC.md Wave B). CirclePhone
 * is ONE responsive tree: below 900px the pre-Wave-B phone page (pixel-identical,
 * honouring the `?tab=` deep link); at 900px+ CircleTabs hides its pills and
 * renders the active tab's wide layout while the context sidebar owns nav.
 */
export default async function CircleFeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const rawTab = Array.isArray(tabParam) ? tabParam[0] : tabParam;
  const initialTab: CircleTab = CIRCLE_TABS.includes(rawTab as CircleTab) ? (rawTab as CircleTab) : "feed";

  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const ctx = await loadCircleContext(id, user.id);

  return <CirclePhone ctx={ctx} currentUserId={user.id} initialTab={initialTab} />;
}
