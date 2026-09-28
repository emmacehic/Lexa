import { expect, test } from "@playwright/test";

/**
 * Flow 2 (§13): delete an annotated word, then re-attach the annotation from
 * the review tray. This is the mechanism that stops a corpus losing evidence
 * silently, so it is worth a test of its own.
 */
test("an annotation that loses its words can be re-attached", async ({ page }) => {
  await page.goto("/library");

  const firstReady = page.locator('a[href^="/r/"]').first();
  test.skip(
    (await firstReady.count()) === 0,
    "Run the transcription flow first so there is a recording to work with.",
  );
  await firstReady.click();
  await expect(page).toHaveURL(/\/r\/[^/]+$/);

  const segment = page.locator("[data-segment-id]").first();
  await expect(segment).toBeVisible();

  // Mark one word, so there is something to lose.
  const word = segment.locator("[data-word-id]").first();
  const surface = (await word.textContent())?.trim() ?? "";
  await word.click();
  await page.getByRole("button", { name: /Code-switch/ }).click();
  await expect(segment.locator("mark.ann")).toHaveCount(1);
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

  // Delete that word by retyping the segment without it.
  const remaining = (await segment.locator("p").textContent())?.trim() ?? "";
  const without = remaining.split(/\s+/).slice(1).join(" ");
  await segment.locator("p").dblclick({ position: { x: 4, y: 4 } });
  const editor = page.getByRole("textbox", { name: "Segment text" });
  await editor.press("Control+a");
  await editor.type(without);
  await editor.press("Escape");

  // The tray appears rather than the annotation disappearing.
  const tray = page.getByRole("button", { name: /lost their words/ });
  await expect(tray).toBeVisible({ timeout: 20_000 });
  await tray.click();
  await expect(page.getByText(`“${surface}”`)).toBeVisible();

  await page.getByRole("button", { name: "Re-attach" }).first().click();
  await segment.locator("[data-word-id]").first().click();
  await page.getByRole("button", { name: "Re-attach here" }).click();

  await expect(segment.locator("mark.ann")).toHaveCount(1);
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
});
