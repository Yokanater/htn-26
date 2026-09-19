import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("report sections and intake have no detected WCAG A/AA violations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".brand-card")).toHaveCount(6);
  const check = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  };
  await check();
  await page.getByRole("tab", { name: "Competitors & discourse" }).click();
  await check();
  await page.getByRole("tab", { name: "SWOT & next steps" }).click();
  await check();
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await check();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Review brand profile" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "New report", exact: true }),
  ).toBeFocused();
});
