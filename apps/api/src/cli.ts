/**
 * Operator commands, run inside the API image:
 *
 *   node dist/cli.js admin:create --email you@example.com [--username you] [--name "Your Name"] [--print-password]
 *   node dist/cli.js demo:seed
 *
 * admin:create (services/admin-bootstrap.service.ts) promotes an existing account
 * without touching its password, or creates the account and emails a "set your password"
 * link. It never prints a password unless --print-password is given: on ECS, stdout goes
 * to CloudWatch Logs. When the link cannot be emailed it creates nothing, prints why and
 * exits non-zero.
 */
process.env.TZ = "UTC";
// The demo seed runs the resume pipeline in this process (no worker needed).
if (process.argv[2] === "demo:seed") process.env.JOBS_MODE = "inline";

import { closeDb, initDbTypes } from "./db/kysely";
import { registerAllJobs } from "./jobs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function adminCreate(): Promise<void> {
  const { createAdmin } = await import("./services/admin-bootstrap.service");
  const result = await createAdmin({ email: arg("email") ?? "", username: arg("username"), name: arg("name"), printPassword: process.argv.includes("--print-password") });
  process.stdout.write(`\n${result.message}\n\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  await initDbTypes();
  // JOBS_MODE=inline runs handlers in this process.
  registerAllJobs();
  if (command === "admin:create") await adminCreate();
  else if (command === "demo:seed") {
    const { seedDemo } = await import("./demo/seed");
    await seedDemo();
  } else throw new Error("commands: admin:create, demo:seed");
}

main()
  .catch((err) => {
    process.stderr.write(`\n${process.argv[2] ?? "cli"} failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
