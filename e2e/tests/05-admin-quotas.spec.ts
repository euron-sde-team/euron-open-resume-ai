import { expect, test } from "@playwright/test";
import { as, demo, DEMO, newUser, pageFor, uniq } from "../helpers";
import { startAnalysis, waitAnalysed } from "../resume-helpers";

interface Tier {
  id: string;
  name: string;
}

test("a one-run tier: the first analysis works, then the app says so plainly and still lets you edit", async ({ browser, request }) => {
  const admin = await demo(request, DEMO.admin);
  const name = uniq("OneRun");
  const tiers = await as<Tier[]>(request, admin, "POST", "/admin/tiers", { name, monthlyRuns: 1, maxResumes: 5, maxUploadMb: 2 });
  const tier = tiers.find((t) => t.name === name)!;
  const user = await newUser(request);
  await as(request, admin, "PUT", `/admin/users/${user.id}/tier`, { tierId: tier.id });

  try {
    await test.step("the allowance shows as runs left, and the upload limit is the tier's", async () => {
      const page = await pageFor(browser, user, "/resumes/new");
      await expect(page.getByTestId("quota-left")).toContainText("1 run left this month");
      await expect(page.getByText(/up to 2 MB/)).toBeVisible();
      await page.context().close();
    });

    const first = await startAnalysis(request, user);
    await waitAnalysed(request, user, first.id);

    await test.step("used up: a visible notice with the reset date, upload and generation are off", async () => {
      const page = await pageFor(browser, user, "/resumes/new");
      await expect(page.getByTestId("quota-exhausted")).toContainText("Monthly runs used up");
      await expect(page.getByTestId("quota-exhausted")).toContainText("reset on");
      await expect(page.getByTestId("upload-submit")).toBeDisabled();
      await page.goto(`/resumes/${first.id}?tab=roadmap`);
      await expect(page.getByTestId("roadmap-generate")).toBeDisabled();
      await page.close();
    });

    await test.step("the API refuses more work with QUOTA_EXHAUSTED and details", async () => {
      const res = await request.post(`${process.env.E2E_API_URL || "http://localhost:5106/api"}/resumes/from-document`, {
        headers: { Authorization: `Bearer ${user.accessToken}`, "X-Forwarded-For": user.ip },
        data: { document: { summary: "Another resume for the quota test." } },
      });
      expect(res.status()).toBe(429);
      const body = await res.json();
      expect(body.code).toBe("QUOTA_EXHAUSTED");
      expect(body.details).toMatchObject({ limit: 1 });
    });

    await test.step("builder: chat is blocked with a reason, hand editing and preview still work", async () => {
      const page = await pageFor(browser, user, "/builder");
      await expect(page.getByTestId("chat-input")).toBeDisabled();
      await expect(page.getByText("Monthly runs used up").first()).toBeVisible();
      await page.getByRole("tab", { name: "Edit sections" }).click();
      await page.getByLabel("Full name").fill("Quota Tester");
      await expect(page.frameLocator("iframe[title^='Preview of']").getByText("Quota Tester").first()).toBeVisible({ timeout: 30_000 });
      await page.context().close();
    });
  } finally {
    await as(request, admin, "PUT", `/admin/users/${user.id}/tier`, { tierId: null });
    await as(request, admin, "DELETE", `/admin/tiers/${tier.id}`, undefined, 200);
  }
});

test("the admin quotas page lists tiers and can add one", async ({ browser, request }) => {
  const admin = await demo(request, DEMO.admin);
  const page = await pageFor(browser, admin, "/admin/quotas");
  await expect(page.getByTestId("admin-quotas")).toBeVisible();
  await expect(page.getByTestId("tier-add")).toBeVisible();
  await expect(page.getByText("Monthly AI runs")).toBeVisible();
  await page.context().close();
});

test("an admin never sees anyone's resumes", async ({ request }) => {
  const admin = await demo(request, DEMO.admin);
  const user = await newUser(request);
  const r = await startAnalysis(request, user);
  await as(request, admin, "GET", `/resumes/${r.id}`, undefined, 404);
});
