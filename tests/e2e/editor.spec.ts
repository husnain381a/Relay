import { expect, test } from "@playwright/test";
test.describe("Actual rich-text composer in an isolated development fixture", () => {
  test.skip(
    process.env.TEST_ALLOW_WRITES === "true",
    "Fixture checks are separate from hosted collaboration tests.",
  );
  test.beforeEach(async ({ page }) => {
    await page.goto("/test-editor");
    await expect(
      page.getByRole("textbox", { name: "Message #editor-tests", exact: true }),
    ).toBeVisible();
  });
  test("failed sends preserve the draft and reuse its ID after reloading", async ({
    page,
  }) => {
    await page
      .getByRole("textbox", { name: "Message #editor-tests", exact: true })
      .fill("Keep this draft");
    await page.getByRole("button", { name: "Fail the next test send" }).click();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator('.composer-area').getByRole("alert")).toContainText(
      "Test transport failure.",
    );
    const first = JSON.parse(
      (await page.getByTestId("attempted-ids").textContent())!,
    )[0];
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Message #editor-tests", exact: true }),
    ).toHaveText("Keep this draft");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByTestId("sent-message")).toHaveText(
      "Keep this draft",
    );
    expect(
      JSON.parse((await page.getByTestId("attempted-ids").textContent())!)[0],
    ).toBe(first);
  });
  test("visual formatting persists as Markdown and Enter sends once", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Bold selected text", exact: true })
      .click();
    await page.keyboard.type("A better idea");
    await expect(page.locator(".rich-text-editor strong")).toHaveText(
      "A better idea",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sent-message")).toHaveText(
      "**A better idea**",
    );
    await expect(
      page.getByRole("textbox", { name: "Message #editor-tests", exact: true }),
    ).toBeEmpty();
  });
  test("Markdown and visual views round-trip supported formatting", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message #editor-tests", exact: true })
      .fill("**Formatted** and `code`");
    await page
      .getByRole("button", { name: "Visual editor", exact: true })
      .click();
    await expect(page.locator(".rich-text-editor strong")).toHaveText(
      "Formatted",
    );
    await expect(page.locator(".rich-text-editor code")).toHaveText("code");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByTestId("sent-message")).toContainText(
      "**Formatted** and `code`",
    );
  });
  test("channel picker inserts an internal link and user mentions survive serialization", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Mention a teammate", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test Writer @test_writer", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Mention a channel", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "#editor-tests Public channel",
        exact: false,
      })
      .click();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const markdown = await page.getByTestId("sent-message").textContent();
    expect(markdown).toMatch(/@test(?:\\)?_writer/);
    expect(markdown).toContain("[#editor-tests](/?workspace=");
  });
  test("paste discards executable HTML and external image nodes", async ({
    page,
  }) => {
    await page
      .getByRole("textbox", { name: "Message #editor-tests", exact: true })
      .focus();
    await page.evaluate(() => {
      const target = document.querySelector(".rich-text-editor")!;
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<p>Safe text</p><script>window.editorExecuted=true</script><img src="https://invalid.example/pixel" onerror="window.editorExecuted=true"><a href="javascript:alert(1)">Unsafe link</a>',
      );
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(page.locator(".rich-text-editor")).toContainText("Safe text");
    expect(await page.evaluate(() => "editorExecuted" in window)).toBe(false);
    await expect(
      page.locator(
        '.rich-text-editor script,.rich-text-editor img,.rich-text-editor [onerror],.rich-text-editor a[href^="javascript:"]',
      ),
    ).toHaveCount(0);
  });
});
