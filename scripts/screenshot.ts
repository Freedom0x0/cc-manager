import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SHOT_DIR = path.resolve('docs/screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const URL = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // 1) Initial load
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=cc-session-manager', { timeout: 5000 }).catch(() => {});
  // Wait for project list to render
  await page.waitForFunction(
    () => document.body.innerText.includes('prompt') || document.body.innerText.includes('cc-session-manager'),
    { timeout: 5000 }
  );
  await page.screenshot({ path: path.join(SHOT_DIR, '01-initial.png'), fullPage: false });
  console.log('✓ 01-initial.png');

  // 2) Click first project (cc-session-manager) — use the div in the project list (left pane)
  await page.locator('div').filter({ hasText: /^cc-session-manager \(\d+\)$/ }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-project-selected.png'), fullPage: false });
  console.log('✓ 02-project-selected.png');

  // 3) Click first session
  await page.click('text=如何高效管理 Claude Code 会话');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-session-selected.png'), fullPage: false });
  console.log('✓ 03-session-selected.png');

  // 4) Type in search box
  const input = page.locator('input[placeholder*="搜索"]');
  await input.fill('401 refresh');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-search.png'), fullPage: false });
  console.log('✓ 04-search.png');

  // 5) Clear search and go to recycle bin
  await input.fill('');
  await page.waitForTimeout(300);
  await page.click('button:has-text("回收站")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, '05-recycle-bin.png'), fullPage: false });
  console.log('✓ 05-recycle-bin.png');

  // 6) Back to main and click delete on a session to show confirm dialog
  await page.click('button:has-text("返回")');
  await page.waitForTimeout(300);
  await page.locator('div').filter({ hasText: /^cc-session-manager \(\d+\)$/ }).first().click();
  await page.waitForTimeout(300);
  // Click first delete-icon button in session list
  await page.locator('button[class*="ant-btn"]').filter({ has: page.locator('span[class*="anticon-delete"]') }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, '06-confirm-soft-delete.png'), fullPage: false });
  console.log('✓ 06-confirm-soft-delete.png');

  await browser.close();
  console.log('\nAll screenshots saved to', SHOT_DIR);
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
