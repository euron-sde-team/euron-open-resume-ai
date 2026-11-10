import { expect, test } from "@playwright/test";
import { newUser, pageFor } from "../helpers";
import { analysedResume, downloadedBytes } from "../resume-helpers";

test("pick another template, see it rendered, download the resume and the cover letter", async ({ browser, request }) => {
  const user = await newUser(request);
  const r = await analysedResume(request, user);
  const page = await pageFor(browser, user, `/resumes/${r.id}?tab=improved`);

  await test.step("the improved resume is shown in a sandboxed frame", async () => {
    const frame = page.locator("iframe[title^='Improved resume']");
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(page.frameLocator("iframe[title^='Improved resume']").getByText("Jordan Reyes").first()).toBeVisible();
  });

  await test.step("the picker lists all 13 templates and a choice changes the preview", async () => {
    await page.getByTestId("template-open").click();
    await expect(page.getByRole("radio")).toHaveCount(13);
    const first = page.getByRole("radio").nth(1);
    await first.click();
    await expect(page.getByTestId("template-dialog")).toHaveCount(0);
    await expect(page.getByTestId("template-open")).not.toContainText("Modern");
    await expect(page.frameLocator("iframe[title^='Improved resume']").getByText("Jordan Reyes").first()).toBeVisible({ timeout: 30_000 });
  });

  await test.step("downloads are real files", async () => {
    const pdf = await downloadedBytes(page, () => page.getByTestId("download-pdf").click());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const docx = await downloadedBytes(page, () => page.getByTestId("download-docx").click());
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const cover = await downloadedBytes(page, () => page.getByTestId("download-cover-pdf").click());
    expect(cover.subarray(0, 4).toString()).toBe("%PDF");
  });

  await page.context().close();
});

test("samples: search and filter, preview, and use one as a starting point", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/samples");
  await expect(page.getByTestId("sample-row").first()).toBeVisible();
  const all = await page.getByTestId("sample-row").count();
  expect(all).toBeGreaterThan(10);

  await page.getByTestId("samples-search").fill("data scientist");
  await expect(page.getByTestId("sample-row")).not.toHaveCount(all);
  await expect(page.getByTestId("sample-row").first()).toContainText(/Data/);

  await page.getByRole("tab", { name: "Senior" }).click();
  await expect(page.getByTestId("samples-count")).toContainText(/sample/);

  await page.getByTestId("sample-row").first().click();
  await expect(page.getByTestId("sample-dialog")).toBeVisible();
  await expect(page.locator("iframe[title^='Sample resume']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("sample-use").click();
  await expect(page).toHaveURL(/\/builder\?draft=/);
  await expect(page.getByTestId("draft-name")).not.toHaveValue("");
  await expect(page.locator("iframe[title^='Preview of']")).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});
