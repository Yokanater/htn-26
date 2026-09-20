/** Run explicitly: node demo/record-walkthrough.mjs --live (one vision call). */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

if (!process.argv.includes('--live'))
  throw new Error('Pass --live to authorize the demo image interpretation call.');
await mkdir('.data/demo-video', { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: '.data/demo-video', size: { width: 1440, height: 1000 } },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
let complete = false;
page.setDefaultTimeout(15000);
try {
  await page.goto('http://127.0.0.1:5174/');
  await page.getByRole('heading', { name: /Find what belongs together/ }).waitFor();
  await page.getByRole('button', { name: 'Start a collection' }).click();
  await page.locator('input[type=file]').setInputFiles('apps/web/public/demo/inspiration.png');
  await page.getByRole('button', { name: /Build my draft brief/ }).click();
  await page
    .getByRole('heading', { name: /Your idea, piece by piece/ })
    .waitFor({ timeout: 70000 });
  await page.screenshot({ path: '.data/demo-video/01-detected.png', fullPage: true });
  console.log('Detected:', await page.locator('.piece-category').allTextContents());
  console.log('Actions:', await page.getByRole('button').allTextContents());
  await page.getByRole('button', { name: 'Find my collection' }).click();
  await page
    .getByRole('button', { name: /^Accept / })
    .first()
    .waitFor({ timeout: 30000 });
  await page.getByText('Privacy & sharing settings', { exact: true }).click();
  await page.getByRole('checkbox', { name: /I agree to share/ }).check();
  await page.getByRole('button', { name: 'Opt in to aggregate insights' }).click();
  await page.getByRole('button', { name: 'Withdraw consent' }).waitFor();
  const accepts = page.getByRole('button', { name: /^Accept / });
  const count = await accepts.count();
  console.log('Approval buttons:', count);
  for (let i = 0; i < count; i++) {
    await accepts.nth(i).click();
    await page.waitForFunction(
      (index) =>
        document.querySelectorAll('.slot-decisions button[aria-pressed="true"]').length > index,
      i,
    );
  }
  await page.getByRole('button', { name: 'Save selection', exact: true }).click();
  await page
    .getByText(/Selection saved/)
    .first()
    .waitFor();
  await page.screenshot({ path: '.data/demo-video/02-approved.png', fullPage: true });
  await page.getByRole('button', { name: 'Merchant', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze store' }).click();
  await page.getByRole('heading', { name: 'Products and brands' }).waitFor();
  await page
    .getByText(/selected together in/)
    .first()
    .waitFor();
  await page.screenshot({ path: '.data/demo-video/03-demand.png', fullPage: true });
  await page.getByRole('button', { name: 'Find products and brands' }).click();
  await page.getByRole('tab', { name: /Bundle products/ }).waitFor();
  await page.screenshot({ path: '.data/demo-video/04-bundles.png', fullPage: true });
  await page.getByRole('tab', { name: /Complementary brands/ }).click();
  await page.screenshot({ path: '.data/demo-video/05-collabs.png', fullPage: true });
  await page.getByRole('tab', { name: /Competitors/ }).click();
  await page.screenshot({ path: '.data/demo-video/06-competitors.png', fullPage: true });
  console.log('End-to-end walkthrough complete');
  complete = true;
} catch (error) {
  await page.screenshot({ path: '.data/demo-video/failure.png', fullPage: true });
  console.log('Visible page:', await page.locator('main').innerText());
  throw error;
} finally {
  await context.close();
  if (complete) await page.video().saveAs('.data/demo-video/rainforest-allbirds-demo.webm');
  await browser.close();
}
