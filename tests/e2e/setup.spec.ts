import { expect, test } from "@playwright/test";
test.describe("Unconfigured deployment", () => {
  test.skip(
    process.env.TEST_ALLOW_WRITES === "true",
    "Real backend tests run separately from the unconfigured setup surface.",
  );
  test("shows an honest setup state, no dummy account, and secure headers", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your space is almost ready." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Good work starts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in to relay/i }),
    ).toHaveCount(0);
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["content-security-policy"]).toContain(
      "object-src 'none'",
    );
    const health = await request.get("/api/health/live");
    expect(health.status()).toBe(200);
    const readiness = await request.get("/api/health");
    expect(readiness.status()).toBe(503);
    expect(errors).toEqual([]);
    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        const c = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) =>
            n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
          );
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      return [
        ".auth-story > p",
        ".auth-form-inner > p",
        ".auth-form-inner > .eyebrow",
        ".setup-panel p",
        ".auth-footnote",
        ".auth-footer",
      ].map((selector) => {
        const el = document.querySelector(selector)!;
        let bg: Element | null = el;
        let color = "rgb(255,255,255)";
        while (bg) {
          const candidate = getComputedStyle(bg).backgroundColor;
          if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
            color = candidate;
            break;
          }
          bg = bg.parentElement;
        }
        const a = luminance(getComputedStyle(el).color),
          b = luminance(color);
        return {
          selector,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    for (const pair of contrast)
      expect(pair.ratio, pair.selector).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: "docs/screenshots/welcome-desktop.png",
      fullPage: true,
    });
  });
  for (const width of [375, 768, 1440]) {
    test(`fits viewport at ${width}px and keyboard focus stays visible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Your space is almost ready." }),
      ).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        view: window.innerWidth,
      }));
      expect(dimensions.page).toBeLessThanOrEqual(dimensions.view);
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/screenshots/welcome-${width}.png`,
        fullPage: true,
      });
    });
  }
  test("unknown pages offer a working return link", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await page.getByRole("link", { name: "Return to Relay" }).click();
    await expect(
      page.getByRole("heading", { name: "Your space is almost ready." }),
    ).toBeVisible();
  });
});
