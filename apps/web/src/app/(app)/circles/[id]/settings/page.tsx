import { getSessionUser } from "@/lib/session";
import { loadCircleContext } from "../load-circle";
import { CirclePhone } from "@/components/circle-screens/circle-phone";

/**
 * Circle context · Settings. Before this route existed the shell's Settings
 * row could only link to the circle root, which renders the Feed — the
 * settings surface was reachable solely via the phone's ?tab=settings.
 * CirclePhone is one responsive tree: below 900px the phone circle page
 * opened on Settings; at 900px+ CircleTabs renders WideSettings. CircleTabs
 * itself bounces non-organisers back to the Feed tab.
 */
export default async function CircleSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const ctx = await loadCircleContext(id, user.id);
  return <CirclePhone ctx={ctx} currentUserId={user.id} initialTab="settings" />;
}
