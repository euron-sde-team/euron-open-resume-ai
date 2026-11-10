/** Job handlers of the resume domain: resume-ai.run (the AI pipeline). */
import { runResumeJob } from "../services/resume/pipeline";
import { registerJob } from "./registry";

export function registerResumeJobs(): void {
  registerJob("resume-ai.run", (data) => runResumeJob(data));
}
