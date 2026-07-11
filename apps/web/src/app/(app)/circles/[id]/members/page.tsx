import { getSessionUser } from "@/lib/session";
import { loadCircleContext } from "../load-circle";
import { CirclePhone } from "@/components/circle-screens/circle-phone";

/**
 * Circle context · Members (WEB-SHELL-SPEC.md Wave B). CirclePhone is one
 * responsive tree: phone = the circle page on its Members segment; 900px+ =
 * CircleTabs' wide members roster.
 */
export default async function CircleMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const ctx = await loadCircleContext(id, user.id);
  return <CirclePhone ctx={ctx} currentUserId={user.id} initialTab="members" />;
}
