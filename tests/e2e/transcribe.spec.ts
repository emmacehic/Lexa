import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Flow 1 (§13): upload → transcribe → edit → annotate → export JSON.
 *
 * This runs the real pipeline against real Google credentials. Point it at a
 * short clip: LEXA_SAMPLE=samples/thirty-seconds.wav pnpm test:e2e
 */

function samplePath(): string | null {
  const explicit = process.env.LEXA_SAMPLE;
  if (explicit && existsSync(explicit)) return explicit;
  const dir = join(process.cwd(), "samples");
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((name) =>
    /\.(mp3|wav|m4a|flac|ogg|aac|mp4|mov|webm|mkv)$/i.test(name),
  );
  return file ? join(dir, file) : null;
}

test("upload, transcribe, edit, annotate and export", async ({ page }) => {
  const sample = samplePath();
  test.skip(
    sample === null,
    "Put a short recording in samples/ (or set LEXA_SAMPLE) before running this test.",
  );

  await page.goto("/library");

  await page.setInputFiles('input[type="file"]', sample!);

  // The processing screen names the stage it is actually in.
  await expect(page).toHaveURL(/\/r\/[^/]+\/processing/, { timeout: 60_000 });

  // …and hands over to the workspace when the transcript exists.
  await expect(page).toHaveURL(/\/r\/[^/]+$/, { timeout: 12 * 60 * 1000 });
  const firstSegment = page.locator("[data-segment-id]").first();
  await expect(firstSegment).toBeVisible();

  // --- edit the text ------------------------------------------------------
  const words = firstSegment.locator("[data-word-id]");
  const wordCount = await words.count();
  expect(wordCount).toBeGreaterThan(0);

  await firstSegment.locator("p").dblclick({ position: { x: 4, y: 4 } });
  const editor = page.getByRole("textbox", { name: "Segment text" });
  await expect(editor).toBeVisible();
  await editor.press("End");
  await editor.type(" Nachtrag");
  await editor.press("Escape");
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
  await expect(firstSegment).toContainText("Nachtrag");

  // --- annotate -----------------------------------------------------------
  await firstSegment.locator("[data-word-id]").first().click();
  await page.getByRole("button", { name: /Loanword/ }).click();
  await expect(firstSegment.locator("mark.ann")).toHaveCount(1);
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

  // --- export -------------------------------------------------------------
  await page.getByRole("button", { name: "Export" }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/\.json ·/)).toBeVisible({ timeout: 30_000 });

  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
});
