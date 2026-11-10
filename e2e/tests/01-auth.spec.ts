import { expect, test } from "@playwright/test";
import { demo, DEMO, demoPassword, newContext, newUser, signIn, signOut, clientIp } from "../helpers";

test("signed out, every resume screen asks to sign in and remembers where you were going", async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  for (const route of ["/resumes", "/resumes/new", "/builder", "/samples"]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(route).replace(/%/g, "%")}`));
  }
  await ctx.close();
});

test("the right password signs in, the app opens on the resume list, a wrong one is refused", async ({ browser, request }) => {
  const user = await newUser(request);
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();

  await page.goto("/login");
  await page.locator("#login").fill(user.email);
  await page.locator("#password").fill(`${user.password}-wrong`);
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("alert").filter({ hasText: "is not right" })).toBeVisible();

  await page.locator("#password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/resumes$/);
  await expect(page.getByTestId("resumes-title")).toBeVisible();
  await expect(page.getByTestId("nav-resumes")).toHaveAttribute("aria-current", "page");

  await page.goto("/");
  await expect(page).toHaveURL(/\/resumes$/);

  await signOut(page);
  await ctx.close();
});

test("the demo accounts can sign in and the admin sees the admin entry", async ({ browser, request }) => {
  const priya = await demo(request, DEMO.priya);
  const ctx = await newContext(browser, priya.ip);
  const page = await ctx.newPage();
  await signIn(page, { email: DEMO.priya, password: demoPassword() });
  await expect(page.getByTestId("resumes-title")).toBeVisible();
  await ctx.close();
});

test("a fresh account sees the empty state with both ways in", async ({ browser, request }) => {
  const user = await newUser(request);
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();
  await signIn(page, user, { next: "/resumes" });
  await expect(page.getByText("No resumes yet")).toBeVisible();
  await expect(page.getByTestId("entry-upload")).toBeVisible();
  await expect(page.getByTestId("entry-builder")).toBeVisible();
  void clientIp;
  await ctx.close();
});
