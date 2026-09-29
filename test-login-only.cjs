const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
mkdirSync('/tmp/demo-screenshots', { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  await page.goto('http://localhost:3100/login');
  await page.screenshot({ path: '/tmp/demo-screenshots/login-before.png' });

  // Log all buttons on the page
  const buttons = await page.locator('button').all();
  for (const b of buttons) {
    const text = await b.innerText();
    const type = await b.getAttribute('type');
    console.log(`button: text="${text.trim()}" type="${type}"`);
  }

  // Try clicking
  await page.fill('input[type="password"]', 'treasury');
  await page.locator('button').filter({ hasText: 'Sign in' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/demo-screenshots/login-after.png' });
  console.log('URL after:', page.url());
  await browser.close();
})();
