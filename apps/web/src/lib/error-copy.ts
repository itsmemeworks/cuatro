// Human copy for API error codes. Raw codes must never reach the UI —
// pass every server error through errorCopy() before rendering.
// Voice: warm, plain, no exclamation marks (see design/HANDOFF.md).

const ERROR_COPY: Record<string, string> = {
  network_error: "Couldn't reach the server. Check your connection and try again.",
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
  already_in: "You're already in for this game.",
  window_not_open: "RSVPs for this game haven't opened yet. Try again closer to the date.",
  no_open_knock: "There's no open ask to withdraw.",
  knock_not_found: "That ask isn't around any more.",
  not_pending: "That ask has already been answered.",
};

const FALLBACK = "Something didn't go through. Give it another tap.";

export function errorCopy(code: string | null | undefined): string {
  if (!code) return FALLBACK;
  return ERROR_COPY[code] ?? FALLBACK;
}
