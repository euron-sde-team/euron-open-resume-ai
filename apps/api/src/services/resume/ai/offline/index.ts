/** The deterministic offline engine: used when no text model is configured, and in tests. */
export { parseResumeText, looksLikeResume, normalizeText } from "./parse";
export { analyzeOffline, measure, totalOf } from "./score";
export { improveBullet, improveDocument, yearsOfExperience } from "./improve";
export { coverLetterOffline, roleFromJd } from "./letter";
export { interviewOffline } from "./interview";
export { roadmapOffline, projectsOffline } from "./growth";
export { chatOffline, mergeDocuments } from "./chat";
