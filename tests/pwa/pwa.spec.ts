import { expect, test } from "@playwright/test";
for (const width of [375, 768, 1440]) {
  test(
    "production install control fits a " + width + "px viewport",
    async ({ page }) => {
      await suppressNativePrompt(page);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await ready(page);
      await offerInstall(page, "dismissed");
      const button = page.getByRole("button", {
        name: "Install App",
        exact: true,
      });
      await expect(button).toBeVisible();
      await button.focus();
      await expect(button).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(errors).toEqual([]);
      if (width === 1440)
        await page.screenshot({
          path: "docs/screenshots/pwa-desktop-install.png",
          fullPage: true,
        });
    },
  );
}

async function suppressNativePrompt(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.addEventListener("beforeinstallprompt", (event) => {
      if (!(event as Event & { relayTest?: boolean }).relayTest) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  });
}
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".auth-page")).toBeVisible();
}
async function offerInstall(
  page: import("@playwright/test").Page,
  outcome: "accepted" | "dismissed",
) {
  await page.evaluate((choice) => {
    const state = window as Window & { promptCalls?: number };
    state.promptCalls = 0;
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        relayTest: true,
        prompt: async () => {
          state.promptCalls!++;
        },
        userChoice: Promise.resolve({ outcome: choice, platform: "web" }),
      },
    );
    window.dispatchEvent(event);
  }, outcome);
}

test("serves a complete standalone manifest, real icons, Apple metadata and safe worker headers", async ({
  page,
  request,
}) => {
  await ready(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Relay",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(
    manifest.icons.some(
      (icon: { purpose: string }) => icon.purpose === "maskable",
    ),
  ).toBe(true);
  for (const icon of [
    ...manifest.icons,
    { src: "/icons/apple-touch-icon.png", sizes: "180x180" },
  ]) {
    const image = await request.get(icon.src);
    expect(image.status()).toBe(200);
    const png = await image.body();
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  }
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );
  const worker = await request.get("/sw.js");
  expect(worker.headers()["content-type"]).toContain("application/javascript");
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
  expect(worker.headers()["set-cookie"]).toBeUndefined();
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

for (const outcome of ["accepted", "dismissed"] as const) {
  test(
    "offers installation only on a browser event and consumes the " +
      outcome +
      " prompt once",
    async ({ page }) => {
      await suppressNativePrompt(page);
      await ready(page);
      await expect(
        page.getByRole("button", { name: "Install App", exact: true }),
      ).toHaveCount(0);
      await offerInstall(page, outcome);
      const install = page.getByRole("button", {
        name: "Install App",
        exact: true,
      });
      await expect(install).toBeVisible();
      await install.click();
      await expect(install).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { promptCalls: number }).promptCalls,
        ),
      ).toBe(1);
      if (outcome === "dismissed") {
        await offerInstall(page, "accepted");
        await expect(install).toBeVisible();
      }
      await page.evaluate(() =>
        window.dispatchEvent(new Event("appinstalled")),
      );
      await expect(install).toHaveCount(0);
    },
  );
}

test("handles a rejected installation prompt with accessible recovery", async ({
  page,
}) => {
  await suppressNativePrompt(page);
  await ready(page);
  await page.evaluate(() => {
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt"), {
        relayTest: true,
        prompt: async () => {
          throw new Error("Browser denied prompt");
        },
        userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      }),
    );
  });
  await page.getByRole("button", { name: "Install App", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Installation unavailable" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("provides mobile Home Screen guidance with focus restoration", async ({
  page,
}) => {
  await suppressNativePrompt(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    Object.defineProperty(navigator, "platform", { value: "iPhone" });
  });
  await ready(page);
  const button = page.getByRole("button", { name: "Install App", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog", {
    name: "Install Relay on your device",
  });
  await expect(
    dialog.getByText("Add to Home Screen", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/pwa-mobile-install.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("hides installation controls in standalone mode and in the native desktop shell", async ({
  browser,
}) => {
  for (const native of [false, true]) {
    const context = await browser.newContext();
    await context.addInitScript((isNative) => {
      if (isNative)
        Object.defineProperty(window, "relayDesktop", {
          value: { onDeepLink: () => () => {} },
        });
      else Object.defineProperty(navigator, "standalone", { value: true });
    }, native);
    const page = await context.newPage();
    await ready(page);
    await offerInstall(page, "accepted");
    await expect(
      page.getByRole("button", { name: "Install App", exact: true }),
    ).toHaveCount(0);
    await context.close();
  }
});

test("uses the real worker for an offline fallback without caching private requests", async ({
  page,
  context,
}) => {
  await ready(page);
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await fetch("/api/health/live");
    await fetch("/auth/reset");
  });
  const paths = await page.evaluate(async () => {
    const cache = await caches.open("relay-public-v1");
    return (await cache.keys())
      .map((request) => new URL(request.url).pathname)
      .sort();
  });
  expect(paths).toEqual(
    [
      "/icons/apple-touch-icon.png",
      "/icons/relay-192.png",
      "/icons/relay-512.png",
      "/icons/relay-maskable-512.png",
      "/icons/relay.svg",
      "/offline.html",
    ].sort(),
  );
  await context.setOffline(true);
  const bypasses = await page.evaluate(async () =>
    Promise.all(
      ["/api/health/live", "/auth/reset"].map((url) =>
        fetch(url)
          .then(() => "unexpected response")
          .catch(() => "network error"),
      ),
    ),
  );
  expect(bypasses).toEqual(["network error", "network error"]);
  await page.goto("/?workspace=00000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "You’re offline." }),
  ).toBeVisible();
  await expect(
    page.getByText("For your privacy", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/pwa-offline.png",
    fullPage: true,
  });
  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page.locator(".auth-page")).toBeVisible();
});

test("offers an update without forcing a reload and activates it only on request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as { workerMessages: unknown[] };
    state.workerMessages = [];
    const waiting = {
      postMessage: (message: unknown) => state.workerMessages.push(message),
    };
    const registration = Object.assign(new EventTarget(), {
      waiting,
      installing: null,
    });
    const container = Object.assign(new EventTarget(), {
      controller: {},
      register: async () => registration,
    });
    Object.defineProperty(navigator, "serviceWorker", { value: container });
  });
  await ready(page);
  const notice = page.getByRole("complementary", { name: "App update" });
  await expect(notice).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { workerMessages: unknown[] }).workerMessages,
    ),
  ).toEqual([]);
  await notice.getByRole("button", { name: "Reload", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { workerMessages: unknown[] }).workerMessages,
    ),
  ).toEqual([{ type: "SKIP_WAITING" }]);
  await expect(
    notice.getByRole("button", { name: "Updating…" }),
  ).toBeDisabled();
});
