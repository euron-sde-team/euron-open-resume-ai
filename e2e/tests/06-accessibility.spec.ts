import { expect, test, type Page } from "@playwright/test";
import { newUser, pageFor } from "../helpers";
import { analysedResume, axeProblems } from "../resume-helpers";

const schemes = ["light", "dark"] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

test("the main pages have no serious accessibility violations, in light and dark", async ({ browser, request }) => {
  const user = await newUser(request);
  const r = await analysedResume(request, user);
  const page = await pageFor(browser, user, "/resumes");
  const pages: { name: string; url: string; ready: () => Promise<void> }[] = [
    { name: "resume list", url: "/resumes", ready: () => expect(page.getByTestId("resume-row").first()).toBeVisible() },
    { name: "upload", url: "/resumes/new", ready: () => expect(page.getByTestId("dropzone")).toBeVisible() },
    { name: "report analysis", url: `/resumes/${r.id}`, ready: () => expect(page.getByTestId("analysis-tab")).toBeVisible({ timeout: 30_000 }) },
    { name: "report improved", url: `/resumes/${r.id}?tab=improved`, ready: () => expect(page.getByTestId("improved-tab")).toBeVisible() },
    { name: "report interview", url: `/resumes/${r.id}?tab=interview`, ready: () => expect(page.getByTestId("interview-tab")).toBeVisible() },
    { name: "builder", url: "/builder", ready: () => expect(page.getByTestId("chat-input")).toBeVisible() },
    { name: "samples", url: "/samples", ready: () => expect(page.getByTestId("sample-row").first()).toBeVisible() },
  ];
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const p of pages) {
      await test.step(`${p.name}, ${scheme}`, async () => {
        await page.goto(p.url);
        await p.ready();
        await settle(page);
        // The resume itself is a printed page in a sandboxed frame, outside the app's palette.
        const problems = await axeProblems(page, { exclude: ["iframe"] });
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  }
  await page.context().close();
});

test("dialogs trap focus and close on Escape", async ({ browser, request }) => {
  const user = await newUser(request);
  const r = await analysedResume(request, user);
  const page = await pageFor(browser, user, `/resumes/${r.id}?tab=improved`);
  await page.getByTestId("template-open").click();
  await expect(page.getByTestId("template-dialog")).toBeVisible();
  for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("template-dialog")).toHaveCount(0);
  await expect(page.getByTestId("template-open")).toBeFocused();

  await page.goto("/resumes");
  await page.getByTestId("resume-row").first().hover();
  await page.getByTestId("resume-delete").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.context().close();
});

test("every icon button has a name and tabs are tabs", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/builder");
  const unnamed = await page.$$eval("button", (els) => els.filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby")).length);
  expect(unnamed).toBe(0);
  await expect(page.getByRole("tablist", { name: "Builder views" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  await page.context().close();
});
