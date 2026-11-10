/**
 * The two seams the resume services call: AI tasks and the renderer. Production uses the
 * real implementations; tests inject fakes with `setResumeDeps` so nothing reaches a model
 * or a browser.
 */
import type { ResumeAiTasks } from "./ai-tasks";
import { resumeAiTasks } from "./ai";
import { resumeRenderer } from "./render";
import type { ResumeRenderer } from "./renderer";

let ai: ResumeAiTasks = resumeAiTasks;
let renderer: ResumeRenderer = resumeRenderer;

export const aiTasks = (): ResumeAiTasks => ai;
export const resumeRendererDep = (): ResumeRenderer => renderer;

export function setResumeDeps(deps: { ai?: ResumeAiTasks; renderer?: ResumeRenderer }): void {
  if (deps.ai) ai = deps.ai;
  if (deps.renderer) renderer = deps.renderer;
}

export function resetResumeDeps(): void {
  ai = resumeAiTasks;
  renderer = resumeRenderer;
}
