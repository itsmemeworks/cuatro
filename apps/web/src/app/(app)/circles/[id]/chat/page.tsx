import { getSessionUser } from "@/lib/session";
import { loadCircleContext } from "../load-circle";
import { CirclePhone } from "@/components/circle-screens/circle-phone";

/**
 * Circle context · Chat (WEB-SHELL-SPEC.md Wave B). CirclePhone is one responsive
 * tree: below 900px the phone circle page opened on Chat (never a dead end); at
 * 900px+ CircleTabs renders the wide Chat layout. CircleChat is a single instance
 * (it marks the circle read on mount), so it is never double-mounted.
 */
export default async function CircleChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const ctx = await loadCircleContext(id, user.id);
  return <CirclePhone ctx={ctx} currentUserId={user.id} initialTab="chat" />;
}
