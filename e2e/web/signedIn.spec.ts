import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Signed-in smoke with a DEDICATED tester account (E2E_EMAIL / E2E_PASSWORD in
 * the environment or a git-ignored `.env.test`). Skipped when they are absent.
 * Read-only: it opens screens and counts requests — it creates and deletes
 * nothing. The account must already be approved (profiles.is_approved).
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!EMAIL || !PASSWORD, "set E2E_EMAIL and E2E_PASSWORD to run the signed-in smoke");

async function signIn(page: Page) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator("input[type=email]").fill(EMAIL!);
  await page.locator("input[type=password]").fill(PASSWORD!);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/(dashboard|workspace|pending-approval|complete-profile)/, { timeout: 30_000 });
  await expect(page, "tester account is approved and has a completed profile").toHaveURL(/\/(dashboard|workspace)/);
}

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("the dashboard greets the user and offers the three core jobs", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("textbox").first()).toBeVisible();
  });

  test("the workspace loads its document tree in a handful of requests, not dozens", async ({ page }) => {
    const rest: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.includes("/rest/v1/")) rest.push(u.pathname.split("/").pop() ?? "");
    });
    await page.goto("/workspace", { waitUntil: "networkidle" });
    const count = (table: string) => rest.filter((t) => t === table).length;

    // Each mount of useAllDocuments used to fetch the whole tree: 48 `documents`
    // calls and 6 `projects` calls on one load.
    expect(count("documents"), `documents requests: ${count("documents")}`).toBeLessThanOrEqual(3);
    expect(count("projects"), `projects requests: ${count("projects")}`).toBeLessThanOrEqual(2);
    expect(count("profiles"), `profiles requests: ${count("profiles")}`).toBeLessThanOrEqual(2);
  });

  test("the workbench tabs are labelled", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "networkidle" });
    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    for (const tab of await tabs.all()) {
      const name = (await tab.textContent())?.trim() || (await tab.getAttribute("aria-label"));
      expect(name, "a tab with no visible or accessible name").toBeTruthy();
    }
  });

  for (const path of ["/dashboard", "/files", "/settings", "/workspace"]) {
    test(`${path} shows content, not a blank page, within 6 s`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main, [role=main], h1").first()).toBeVisible({ timeout: 6_000 });
      const text = (await page.locator("body").innerText()).trim();
      expect(text.length, "body text").toBeGreaterThan(40);
    });

    test(`${path} fits the viewport and has no critical accessibility violations`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);

      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const critical = violations.filter((v) => v.impact === "critical");
      expect(critical.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }

  test("dates follow the app language, not the browser's", async ({ page }) => {
    await page.goto("/files", { waitUntil: "networkidle" });
    const lang = await page.locator("html").getAttribute("lang");
    test.skip(lang !== "ur" && lang !== "ar", "only meaningful when the account's language is Urdu or Arabic");
    const body = await page.locator("body").innerText();
    expect(body, "English month abbreviation in a non-English UI").not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}\b/);
  });
});
