import { redirect } from "next/navigation";

/**
 * The standalone games list merged into the Games tab's home screen (see
 * (app)/home/page.tsx — it now shows the full upcoming-sessions list, not
 * just the top 3, plus the "Manage" standing-games link this page used to
 * carry). This route is kept as a redirect rather than deleted so no old
 * link, bookmark, or push-notification deep link 404s.
 */
export default function GamesListRedirect() {
  redirect("/home");
}
