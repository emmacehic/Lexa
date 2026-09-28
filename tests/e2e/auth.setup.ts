import { test as setup, expect } from "@playwright/test";

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@lexa.local";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

/** Signs in once with the seeded admin and reuses the session. */
setup("authenticate", async ({ page }) => {
  setup.skip(
    PASSWORD.length === 0,
    "Set SEED_ADMIN_PASSWORD in .env.local and run `pnpm seed` before the end-to-end tests.",
  );

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
