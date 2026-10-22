import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Signed-out smoke: every screen a visitor can reach renders, fits the
 * viewport, is not broken for screen readers, and the gated screens send a
 * visitor to /login. Nothing here needs an account.
 */

const PUBLIC_PAGES = ["/", "/login", "/signup", "/forgot-password", "/about", "/faq", "/privacy", "/terms"];

/** Errors that come from the platform or third parties, not from this app. */
const IGNORED_CONSOLE = [/favicon/i, /ResizeObserver loop/i, /Failed to load resource.*(401|403|404)/i];

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  // 1px of slack for sub-pixel rounding.
  expect(scrollWidth, "page is wider than the viewport").toBeLessThanOrEqual(innerWidth + 1);
}

// A brand-new visitor is shown the first-run language picker before anything
// else (FirstRunLanguageGate); a returning one has a saved choice.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("easyeditor-lang", "en"));
});

for (const path of PUBLIC_PAGES) {
  test.describe(path, () => {
    test("renders, with a title, a language and a direction, and no app errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) errors.push(m.text());
      });

      const res = await page.goto(path, { waitUntil: "networkidle" });
      expect(res?.status(), "HTTP status").toBeLessThan(400);

      await expect(page).toHaveTitle(/.+/);
      const html = page.locator("html");
      await expect(html).toHaveAttribute("lang", /^(ur|ar|en)/);
      await expect(html).toHaveAttribute("dir", /^(rtl|ltr)$/);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("fits the viewport (no sideways scroll)", async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      await noHorizontalScroll(page);
    });

    test("has no critical accessibility violations", async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const critical = violations.filter((v) => v.impact === "critical");
      expect(
        critical.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
        "critical axe violations",
      ).toEqual([]);
      // Serious ones are reported, not failed on: they show up in the run's annotations.
      for (const v of violations.filter((x) => x.impact === "serious")) {
        test.info().annotations.push({ type: "axe-serious", description: `${v.id}: ${v.help} (${v.nodes.length})` });
      }
    });
  });
}

test.describe("login form", () => {
  test("every field has an accessible name", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    const unnamed = await page.$$eval("input:not([type=hidden]), button", (els) =>
      els
        .filter((el) => {
          const e = el as HTMLInputElement;
          const labelled = (e.labels && e.labels.length > 0) || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby");
          return !(labelled || e.textContent?.trim() || e.getAttribute("title"));
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed, "controls with no accessible name").toEqual([]);
  });

  test("a wrong password shows an error and stays on the page", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.locator("input[type=email]").fill("nobody-e2e@example.invalid");
    await page.locator("input[type=password]").fill("not-a-real-password-1");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("[role=alert], [data-sonner-toast], .text-destructive").first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("gated screens", () => {
  for (const path of ["/dashboard", "/workspace", "/files", "/settings", "/admin"]) {
    test(`${path} sends a signed-out visitor to /login`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/(login|ur\/login|ar\/login)/);
    });
  }
});
