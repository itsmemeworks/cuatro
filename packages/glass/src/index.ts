export * from "./types.js";
export * from "./constants.js";
export {
  clampConfidence,
  clampRating,
  confidenceMultiplier,
  echoDamping,
  fixtureKey,
  kFor,
  marginMultiplier,
  round2,
  winExpectancy,
} from "./rating-math.js";
export type { EchoDampingResult } from "./rating-math.js";
export { buildExplanation } from "./explanation.js";
export type { ExplanationInput } from "./explanation.js";
export { createPlayer, playerStatus, processMatch } from "./engine.js";
