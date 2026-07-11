// Human copy for API error codes. Raw codes must never reach the UI —
// pass every server error through errorCopy() before rendering.
// Voice: warm, plain, no exclamation marks (see design/HANDOFF.md).

const ERROR_COPY: Record<string, string> = {
  rate_limited: "Easy does it. Give it a minute and try again.",
  network_error: "Couldn't reach the server. Check your connection and try again.",
  last_organiser: "You're the only organiser. Hand the Circle to someone else before you leave.",
  target_not_a_member: "That player isn't in this Circle any more.",
  cannot_remove_self: "You can't remove yourself. Use Leave this Circle instead.",
  cannot_transfer_to_self: "You're already an organiser.",
  cannot_transfer_to_guest: "Guests can't be organisers. Pick a member who's signed in.",
  something_went_wrong: "Something didn't go through. Give it another tap.",
  not_a_member: "You're not in this Circle, so that action isn't available.",
  not_member: "You're not in this Circle, so that action isn't available.",
  invalid_invite: "That invite link doesn't work any more. Ask for a fresh one.",
  invalid_invite_code: "That invite link doesn't work any more. Ask for a fresh one.",
  already_full: "That game just filled up.",
  bad_request: "Something about that didn't add up. Check it and try again.",
  too_long: "That's a bit too long. Shorten it and try again.",
  unauthorized: "You've been signed out. Sign in and try again.",
  not_an_organiser: "Only the Circle's organiser can do that.",
  invalid_weekday: "Pick a day of the week for the game.",
  invalid_start_time: "That start time doesn't look right. Use HH:MM.",
  session_started: "That game has already started.",
  no_fourth_call_invite: "This link isn't live any more. The spot may have been filled.",
  // Knocks (The Board — ask-to-join a game near you).
  already_knocked: "You've already asked to join this game. The organiser will get back to you.",
  already_member: "You're already in this Circle, so just RSVP to the game.",
  circle_full: "That Circle is at its limit, so no one new can join right now.",
  // Circle settings + create field errors (Circle v2).
  invalid_max_members: "Set a limit from 4 to 64 players, or leave it open. It can't drop below who's already in.",
  invalid_header_image: "Pick one of the header images.",
  invalid_home_venue: "Pick a venue from the list for your home court.",
  already_in: "You're already in for this game.",
  window_not_open: "RSVPs for this game haven't opened yet. Try again closer to the date.",
  no_open_knock: "There's no open ask to withdraw.",
  knock_not_found: "That ask isn't around any more.",
  not_pending: "That ask has already been answered.",
  // The Rotation.
  rotation_not_enabled: "This game isn't on rotation, so just tap in.",
  rotation_locked: "This week's four is already set. Tap in or out on the game itself.",
};

const FALLBACK = "Something didn't go through. Give it another tap.";

export function errorCopy(code: string | null | undefined): string {
  if (!code) return FALLBACK;
  return ERROR_COPY[code] ?? FALLBACK;
}
