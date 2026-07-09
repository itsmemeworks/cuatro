// Human copy for API error codes. Raw codes must never reach the UI —
// pass every server error through errorCopy() before rendering.
// Voice: warm, plain, no exclamation marks (see design/HANDOFF.md).

const ERROR_COPY: Record<string, string> = {
  network_error: "Couldn't reach the server — check your connection and try again.",
  something_went_wrong: "Something didn't go through. Give it another tap.",
  not_a_member: "You're not in this Circle, so that action isn't available.",
  not_member: "You're not in this Circle, so that action isn't available.",
  invalid_invite: "That invite link doesn't work any more — ask for a fresh one.",
  invalid_invite_code: "That invite link doesn't work any more — ask for a fresh one.",
  already_full: "That game just filled up.",
  bad_request: "Something about that didn't add up — check it and try again.",
  too_long: "That's a bit too long — shorten it and try again.",
  unauthorized: "You've been signed out — sign in and try again.",
  not_an_organiser: "Only the Circle's organiser can do that.",
  invalid_weekday: "Pick a day of the week for the game.",
  invalid_start_time: "That start time doesn't look right — use HH:MM.",
  session_started: "That game has already started.",
  no_fourth_call_invite: "This link isn't live any more — the spot may have been filled.",
};

const FALLBACK = "Something didn't go through. Give it another tap.";

export function errorCopy(code: string | null | undefined): string {
  if (!code) return FALLBACK;
  return ERROR_COPY[code] ?? FALLBACK;
}
