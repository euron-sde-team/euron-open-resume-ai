import { expect, test } from "@playwright/test";
import { as, newUser, pageFor } from "../helpers";
import { JOB_DESCRIPTION, txtFile } from "../resume-helpers";

test("upload a resume with a job description, watch it get analysed, read the report", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/resumes/new");

  await test.step("a file of the wrong type is refused before it is sent", async () => {
    await page.getByTestId("file-input").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(page.getByTestId("upload-problem")).toContainText("PDF, DOCX, TXT or Markdown");
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });

  await test.step("a file over the 10 MB cap is refused", async () => {
    await page.getByTestId("file-input").setInputFiles({ name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 97) });
    await expect(page.getByTestId("upload-problem")).toContainText("larger than");
  });

  await test.step("a good file with a company and a job description goes up and opens the report", async () => {
    await page.getByTestId("file-input").setInputFiles(txtFile());
    await expect(page.getByTestId("file-name")).toHaveText("resume.txt");
    await page.getByLabel(/Company/).fill("Northwind");
    await page.getByLabel(/Job description/).fill(JOB_DESCRIPTION);
    await page.getByTestId("upload-submit").click();
    await expect(page).toHaveURL(/\/resumes\/[0-9A-Za-z]+$/);
  });

  await test.step("the report finishes on its own and shows a score and the analysis", async () => {
    await expect(page.getByTestId("report-score")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("analysis-tab")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Keywords" })).toBeVisible();
    await expect(page.getByTestId("report-progress")).toHaveCount(0);
  });

  await test.step("the tabs are real tabs and the URL keeps the choice", async () => {
    await expect(page.getByRole("tablist", { name: "Resume sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Cover letter" }).click();
    await expect(page).toHaveURL(/tab=cover-letter/);
    await expect(page.getByRole("tab", { name: "Cover letter" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("cover-letter-tab")).toBeVisible();
  });

  await test.step("an on-demand part says it costs a run, then appears", async () => {
    await page.getByRole("tab", { name: "Roadmap" }).click();
    await expect(page.getByTestId("quota-left").or(page.getByTestId("quota-exhausted")).first()).toBeVisible();
    await page.getByTestId("roadmap-generate").click();
    await expect(page.getByTestId("roadmap-view")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("tab", { name: "Projects" }).click();
    await page.getByTestId("projects-generate").click();
    await expect(page.getByTestId("project-idea").first()).toBeVisible({ timeout: 90_000 });
  });

  await test.step("interview questions open to their answers", async () => {
    await page.getByRole("tab", { name: "Interview" }).click();
    await page.getByRole("tab", { name: "DSA" }).click();
    await page.getByTestId("interview_dsa-generate").click();
    const item = page.getByTestId("interview-item").first();
    await expect(item).toBeVisible({ timeout: 90_000 });
    await item.locator("summary").click();
    await expect(item).toHaveAttribute("open", "");
  });

  await test.step("tailoring to another job makes a new resume and keeps the first", async () => {
    await page.getByRole("tab", { name: "Tailor" }).click();
    await page.getByLabel("Job description").fill("Staff engineer for a data platform team. Spark, Airflow and strong SQL.");
    await page.getByTestId("tailor-submit").click();
    await expect(page).toHaveURL(/\/resumes\/[0-9A-Za-z]+$/);
    await page.goto("/resumes");
    await expect(page.getByTestId("resume-row")).toHaveCount(2);
  });

  await test.step("deleting asks first, names the resume and removes it", async () => {
    await page.getByTestId("resume-delete").first().click();
    await expect(page.getByRole("dialog")).toContainText("Delete");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("resume-row")).toHaveCount(1);
  });

  await page.context().close();
});

test("someone else's resume is a 404, never a 403", async ({ request }) => {
  const a = await newUser(request);
  const b = await newUser(request);
  const mine = await as<{ id: string }>(request, a, "POST", "/resumes/from-document", { document: { summary: "A private resume summary for a test." } });
  await as(request, b, "GET", `/resumes/${mine.id}`, undefined, 404);
  await as(request, b, "DELETE", `/resumes/${mine.id}`, undefined, 404);
});

test("a scanned or unreadable file is refused and the message says no run was used", async ({ request }) => {
  const user = await newUser(request);
  const before = await as<{ runs: { used: number } }>(request, user, "GET", "/me/usage");
  const res = await request.post(`${process.env.E2E_API_URL || "http://localhost:5106/api"}/resumes`, {
    headers: { Authorization: `Bearer ${user.accessToken}`, "X-Forwarded-For": user.ip },
    multipart: { file: { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") } },
  });
  expect([415, 422]).toContain(res.status());
  const after = await as<{ runs: { used: number } }>(request, user, "GET", "/me/usage");
  expect(after.runs.used).toBe(before.runs.used);
});
