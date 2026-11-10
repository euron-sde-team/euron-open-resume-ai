/**
 * One helper per API route, grouped by area (the same groups as apps/api/src/routes).
 * Add a `resumeEndpoints(h)` group next to coreEndpoints and spread it below.
 * Paths are relative to the API base (which includes /api).
 */
import type { HttpClient } from "../http";
import { adminEndpoints } from "./admin";
import { coreEndpoints } from "./core";
import { helpers } from "./helpers";
import { resumeEndpoints } from "./resume";

export function createEndpoints(http: HttpClient) {
  const h = helpers(http);
  return { ...coreEndpoints(h), ...adminEndpoints(h), ...resumeEndpoints(h) };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export type { PageQuery } from "./helpers";
export * from "./core";
export * from "./admin";
export * from "./resume";
