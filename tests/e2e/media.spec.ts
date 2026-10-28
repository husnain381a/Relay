import { expect, test, type Page } from "@playwright/test";

async function rasterFile(page: Page, { width = 800, height = 600, type = "image/png" } = {}) {
  const bytes = await page.evaluate(async ({ width, height, type }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
    context.fillStyle = "#5c4bc4"; context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, Math.max(1, width / 3), Math.max(1, height / 3));
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, .9));
    if (!blob || blob.type !== type) throw new Error("The requested encoder is unavailable.");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { width, height, type });
  return { name: `chosen.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`, mimeType: type, buffer: Buffer.from(bytes) };
}

test.describe("Actual browser image preparation without a backend", () => {
  test.skip(process.env.TEST_ALLOW_WRITES === "true", "Local image fixtures are separate from hosted collaboration tests.");
  test.beforeEach(async ({ page }) => {
    await page.goto("/test-media");
    await expect(page.getByRole("heading", { name: "Isolated image preparation fixture", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(window.relayMediaHarness))).toBe(true);
  });

  test("real JPEG, PNG and WebP bytes decode and re-encode to bounded raster dimensions", async ({ page }) => {
    const results = await page.evaluate(async () => {
      const values = [];
      for (const type of ["image/jpeg", "image/png", "image/webp"]) {
        const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 640;
        const context = canvas.getContext("2d")!; context.fillStyle = "#5c4bc4"; context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, .9));
        if (!blob || blob.type !== type) throw new Error(`Encoder unavailable: ${type}`);
        values.push(await window.relayMediaHarness!.inspect(new File([blob], "local-image", { type })));
      }
      return values;
    });
    expect(results.map(value => value.type)).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const value of results) { expect(value.width).toBe(512); expect(value.height).toBe(320); expect(value.size).toBeGreaterThan(0); expect(value.size).toBeLessThanOrEqual(2 * 1024 * 1024); }
  });

  test("the real settings control previews a prepared image and Cancel discards it without network writes", async ({ page }) => {
    const backendRequests: string[] = [];
    page.on("request", request => { if (/supabase\.(co|in)|\/(auth|storage|rest)\/v1\//.test(request.url())) backendRequests.push(request.method()); });
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles(await rasterFile(page));
    await expect(page.getByRole("region", { name: "Profile photo", exact: true }).getByRole("status")).toHaveText("Image ready. Save to update your team’s view.");
    const preview = page.getByRole("img", { name: "Selected profile photo preview", exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(element => ({ width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }))).toEqual({ width: 512, height: 384 });
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose image", exact: true })).toBeEnabled();
    expect(backendRequests).toEqual([]);
  });

  test("rejects an actual raster beyond the dimension budget with a focused inline error", async ({ page }) => {
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles(await rasterFile(page, { width: 5000, height: 1 }));
    const error = page.getByRole("region", { name: "Profile photo", exact: true }).getByRole("alert");
    await expect(error).toHaveText("Choose an image no larger than 4096 × 4096 pixels.");
    await expect(error).toBeFocused();
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Selected profile photo preview", exact: true })).toHaveCount(0);
  });

  test("rejects executable SVG content disguised as PNG and never interprets it", async ({ page }) => {
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles({ name: "impostor.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.mediaExecuted=true"><rect width="100" height="100"/></svg>') });
    await expect(page.getByRole("region", { name: "Profile photo", exact: true }).getByRole("alert")).toContainText("does not match its image format");
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => "mediaExecuted" in window)).toBe(false);
  });

  test("rejects oversized input before preparation and accepts a valid replacement afterward", async ({ page }) => {
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await expect(page.getByRole("region", { name: "Profile photo", exact: true }).getByRole("alert")).toHaveText("Choose an image no larger than 2 MiB.");
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toHaveCount(0);
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles(await rasterFile(page, { width: 64, height: 64, type: "image/jpeg" }));
    await expect(page.getByRole("region", { name: "Profile photo", exact: true }).getByRole("alert")).toBeHidden();
    await expect(page.getByRole("img", { name: "Selected profile photo preview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save photo", exact: true })).toBeEnabled();
  });

  test("image settings and local preview fit a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.getByLabel("Choose profile photo", { exact: true }).setInputFiles(await rasterFile(page));
    await expect(page.getByRole("img", { name: "Selected profile photo preview", exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });
});
