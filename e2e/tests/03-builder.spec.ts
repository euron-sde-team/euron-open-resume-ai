import { expect, test } from "@playwright/test";
import { newUser, pageFor } from "../helpers";
import { downloadedBytes, txtFile } from "../resume-helpers";

test("build by chatting: live preview, hand edits, save, reopen, download, analyse", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/builder");
  const preview = page.frameLocator('iframe[title^="Preview of"]');

  await test.step("the builder opens with a prompt and an empty page", async () => {
    await expect(page.getByTestId("chat-log")).toContainText("Tell me about yourself");
    await expect(page.getByTestId("download-menu")).toBeDisabled();
  });

  await test.step("a message gets a reply and the preview fills in", async () => {
    await page.getByTestId("chat-input").fill("I am Jordan Reyes, a backend engineer in Denver with six years of experience in payments. Email jordan.reyes@example.com.");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-assistant")).toHaveCount(2, { timeout: 90_000 });
    await expect(page.getByTestId("draft-state")).toHaveText("Unsaved");
    await expect(page.locator("iframe[title^='Preview of']")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the preview iframe is sandboxed with no permissions", async () => {
    await expect(page.locator("iframe[title^='Preview of']")).toHaveAttribute("sandbox", "");
  });

  await test.step("edit sections fixes anything by hand and the preview follows", async () => {
    await page.getByRole("tab", { name: "Edit sections" }).click();
    await page.getByLabel("Full name").fill("Jordan A. Reyes");
    await expect(preview.getByText("Jordan A. Reyes").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Add job/ }).click();
    await page.getByLabel("Title").first().fill("Staff Engineer");
    await page.getByLabel("Bullets, one per line").first().fill("Shipped the ledger rewrite.\nMentored three engineers.");
    await expect(preview.getByText("Shipped the ledger rewrite.")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("save as a draft, then it is listed and survives a reload", async () => {
    await page.getByTestId("draft-name").fill("Backend resume e2e");
    await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-state")).toHaveText("Saved");
    await expect(page).toHaveURL(/draft=/);
    await page.reload();
    await expect(page.getByTestId("draft-name")).toHaveValue("Backend resume e2e");
    await page.getByTestId("drafts-open").click();
    await expect(page.getByTestId("draft-row")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drafts-drawer")).toHaveCount(0);
  });

  await test.step("download PDF and DOCX", async () => {
    const pdf = await downloadedBytes(page, async () => {
      await page.getByTestId("download-menu").click();
      await page.getByTestId("download-pdf").click();
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const docx = await downloadedBytes(page, async () => {
      await page.getByTestId("download-menu").click();
      await page.getByTestId("download-docx").click();
    });
    expect(docx.subarray(0, 2).toString()).toBe("PK");
  });

  await test.step("import a file reads it into the document", async () => {
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.getByTestId("builder-file-input").setInputFiles(txtFile("old-resume.txt"));
    await expect(page.getByTestId("chat-user").filter({ hasText: "Imported old-resume.txt" })).toBeVisible();
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 90_000 });
  });

  await test.step("analyse this resume starts an analysis and opens the report", async () => {
    await page.getByTestId("analyse").click();
    await expect(page).toHaveURL(/\/resumes\/[0-9A-Za-z]+$/);
    await expect(page.getByTestId("report-title")).toBeVisible();
  });

  await test.step("deleting a draft asks first", async () => {
    await page.goto("/builder");
    await page.getByTestId("drafts-open").click();
    await page.getByRole("button", { name: /Delete draft Backend resume e2e/ }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Delete draft" })).toBeVisible();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("draft-row")).toHaveCount(0);
  });

  await page.context().close();
});
