export {
  computeMatch,
  findStalledMatches,
  getCurrentMatch,
  getCvCheck,
  parseWeights,
  requestCvCheck,
  requestMatch,
  updateWeights,
  type MatchComputeDeps,
  type MatchRequestDeps,
  type MatchView,
} from "./service";
export { DEFAULT_WEIGHTS, FACTORS, MATCH_CATEGORIES, type MatchCategory, type Weights } from "./score";
export { formatDuration, professionalMonths } from "./rules";
export { autoMatch, listToTriage, requestMissingMatches, triageCounts, type AutoMatchResult, type TriageItem } from "./triage";
