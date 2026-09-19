import { test, expect } from "@playwright/test";

test("explore, filter, save, inspect evidence, and read strategy", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Better, together." }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-overview.png`,
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.locator(".brand-card")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Search brands" }).fill("ceramic");
  await expect(page.locator(".brand-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Save Form & Field", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unsave Form & Field", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("The evidence trail")).toBeVisible();
  await expect(
    drawer.getByText("Fictional source · no external page"),
  ).toHaveCount(2);
  await drawer
    .getByRole("button", { name: "Mark useful", exact: true })
    .click();
  await expect(
    drawer.getByRole("button", { name: "Mark useful", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-evidence.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unsave Form & Field", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Competitors & discourse" }).click();
  await expect(page.locator(".brand-card")).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Around the conversation" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "SWOT & next steps" }).click();
  await expect(page.locator(".swot-card")).toHaveCount(4);
  await expect(page.locator(".action-row")).toHaveCount(3);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-swot.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("new report confirms profile, streams to completion, and exports", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".brand-card")).toHaveCount(6);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Brand name", exact: true })
    .fill("Good Morning Coffee");
  await page
    .getByRole("textbox", { name: "Store URL", exact: true })
    .fill("goodmorning.example");
  await page.getByRole("button", { name: "Review brand profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Does this feel like you?" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Your audience" })
    .fill("Home brewers in Toronto");
  await page.getByRole("button", { name: "Confirm & start demo" }).click();
  await expect(page.getByText("DEMO RESEARCH IN PROGRESS")).toBeVisible();
  await expect(page.locator(".store-name")).toContainText(
    "Good Morning Coffee",
  );
  await expect(page.locator(".progress-panel")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.locator(".brand-card")).toHaveCount(6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^grove-demo-report-.+\.json$/,
  );
});

test("partial provider failure preserves useful results", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brand-card")).toHaveCount(6);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Brand name", exact: true })
    .fill("Partial Coffee");
  await page
    .getByRole("textbox", { name: "Store URL", exact: true })
    .fill("partial.example");
  await page.getByRole("button", { name: "Review brand profile" }).click();
  await page.getByRole("checkbox", { name: "Try a partial report" }).check();
  await page.getByRole("button", { name: "Confirm & start demo" }).click();
  await expect(
    page.getByText("The simulated discourse provider failed.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".brand-card")).toHaveCount(6);
  await page.getByRole("tab", { name: "SWOT & next steps" }).click();
  await expect(
    page.getByText("Strategy needs a little more evidence."),
  ).toBeVisible();
});
