const { chromium } = require('playwright');
const { mkdirSync } = require('fs');

(async () => {
  mkdirSync('/tmp/demo-screenshots', { recursive: true });

  const BASE = 'http://localhost:3100';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  const ss = (name) => page.screenshot({ path: `/tmp/demo-screenshots/${name}.png` });

  let passed = 0, failed = 0;
  const results = [];

  async function check(label, fn) {
    try {
      await fn();
      results.push(`✅ ${label}`);
      passed++;
    } catch (e) {
      results.push(`❌ ${label}: ${e.message.slice(0, 200)}`);
      failed++;
      await ss(`FAIL-${label.replace(/[^a-z0-9]/gi,'-').slice(0,40)}`).catch(()=>{});
    }
  }

  async function waitHydrated() {
    await page.waitForFunction(() => {
      const form = document.querySelector('form');
      if (!form) return true; // no form = no hydration needed
      return Object.keys(form).some(k => k.startsWith('__reactFiber') || k.startsWith('__react'));
    }, { timeout: 10000 });
  }

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  await check('Login page loads', async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForSelector('input[type="password"]');
    await ss('01-login');
  });

  await check('Login with password "treasury" succeeds', async () => {
    await waitHydrated();
    await page.fill('input[type="password"]', 'treasury');
    await page.press('input[type="password"]', 'Enter');
    await page.waitForURL(`${BASE}/`, { timeout: 12000 });
    // Dismiss welcome modal — it opens in a useEffect so may appear shortly after navigation
    try {
      await page.locator('text=Take a look around').click({ timeout: 6000 });
      await page.locator('text=Virtual cards for AI agents').waitFor({ state: 'detached', timeout: 5000 });
    } catch (_) {}
    await ss('02-dashboard');
  });

  // ── TOPBAR / SIDEBAR ────────────────────────────────────────────────────────
  await check('TopBar: Run Agent Task, Ask AI, MCP, About visible', async () => {
    await page.waitForSelector('text=Run Agent Task');
    await page.waitForSelector('text=Ask AI');
    await page.waitForSelector('button:has-text("MCP")');
    await page.waitForSelector('text=About this app');
  });

  await check('Sidebar has Approvals nav item', async () => {
    await page.waitForSelector('a[href="/approvals"]');
  });

  // ── APPROVALS PAGE ─────────────────────────────────────────────────────────
  await check('Approvals page loads with empty state', async () => {
    await page.click('a[href="/approvals"]');
    await page.waitForURL(`${BASE}/approvals`);
    await page.waitForSelector('h1:has-text("Approvals")');
    await page.waitForSelector('text=Approval queue');
    await ss('03-approvals');
  });

  // ── TASK CONFIG MODAL ──────────────────────────────────────────────────────
  await check('Task config modal opens from TopBar button', async () => {
    await page.click('text=Run Agent Task');
    await page.waitForSelector('text=Configure agent task');
    await ss('04-task-config-modal');
  });

  await check('Product change auto-fills amount and description', async () => {
    // Products select is the 2nd select (after Agent)
    const selects = page.locator('select');
    await selects.nth(1).selectOption('github-copilot');
    const amount = await page.locator('input[inputmode="numeric"]').inputValue();
    if (amount !== '19') throw new Error(`Amount expected 19, got "${amount}"`);
    const desc = await page.locator('input[type="text"]').last().inputValue();
    if (!/copilot|github/i.test(desc)) throw new Error(`Desc not updated: "${desc}"`);
    await ss('05-product-change');
  });

  await check('Amount field accepts custom value', async () => {
    const inp = page.locator('input[inputmode="numeric"]');
    await inp.fill('');
    await inp.type('150');
    if (await inp.inputValue() !== '150') throw new Error('Amount not editable');
  });

  await check('Modal closes on Cancel', async () => {
    await page.click('text=Cancel');
    await page.waitForSelector('text=Configure agent task', { state: 'detached' });
  });

  // ── CHAT TRAY ───────────────────────────────────────────────────────────────
  await check('Chat tray opens', async () => {
    await page.click('text=Ask AI');
    await page.waitForSelector('text=AI Assistant');
    await ss('06-chat-open');
  });

  await check('TopBar buttons stay accessible while chat is open', async () => {
    for (const label of ['Run Agent Task', 'About this app']) {
      const box = await page.locator(`text=${label}`).first().boundingBox();
      if (!box) throw new Error(`"${label}" not found`);
      if (box.y > 56) throw new Error(`"${label}" is below TopBar (y=${box.y})`);
    }
  });

  await check('Task config modal renders over chat tray', async () => {
    await page.click('text=Run Agent Task');
    await page.waitForSelector('text=Configure agent task');
    await page.waitForSelector('text=AI Assistant'); // chat behind modal
    await ss('07-modal-over-chat');
    await page.click('text=Cancel');
    await page.waitForSelector('text=Configure agent task', { state: 'detached' });
  });

  // ── MCP PANEL ──────────────────────────────────────────────────────────────
  await check('MCP panel opens alongside chat', async () => {
    await page.click('button:has-text("MCP")');
    await page.waitForSelector('text=MCP traffic');
    await page.waitForSelector('text=AI Assistant');
    await ss('08-both-panels');
  });

  await check('TopBar visible with both panels open', async () => {
    const box = await page.locator('text=Run Agent Task').first().boundingBox();
    if (!box || box.y > 56) throw new Error(`"Run Agent Task" y=${box?.y}`);
  });

  await check('MCP panel closes via close button', async () => {
    // Click the close button inside the MCP panel header
    await page.locator('text=MCP traffic').locator('..').locator('button').last().click();
    await page.waitForSelector('text=MCP traffic', { state: 'detached' });
  });

  await check('Chat tray closes', async () => {
    await page.click('button[aria-label="Close"]');
    // Chat uses CSS translate, not unmount. The backdrop overlay IS conditionally rendered.
    await page.locator('.bg-black\\/40').waitFor({ state: 'detached', timeout: 8000 });
  });

  // ── POLICIES PAGE ──────────────────────────────────────────────────────────
  await check('Policy form: no leading-zero bug on numeric inputs', async () => {
    await page.click('a[href="/policies"]');
    await page.waitForURL(`${BASE}/policies`);
    await page.locator('button:has-text("Edit")').first().click();
    await page.waitForSelector('text=Card expiry');
    const inp = page.locator('input[inputmode="numeric"]').first();
    await inp.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await inp.type('7');
    const val = await inp.inputValue();
    if (val !== '7') throw new Error(`Expected "7", got "${val}" — leading zero bug`);
    await ss('09-policy-form');
    await page.click('a[href="/policies"]').catch(() => page.goto(`${BASE}/policies`));
    await page.waitForURL(`${BASE}/policies`);
  });

  // ── OTHER PAGES ────────────────────────────────────────────────────────────
  await check('Agents page loads', async () => {
    await page.click('a[href="/agents"]');
    await page.waitForURL(`${BASE}/agents`);
    await page.waitForSelector('h1');
    await ss('10-agents');
  });

  await check('Accounts page loads', async () => {
    await page.click('a[href="/accounts"]');
    await page.waitForURL(`${BASE}/accounts`);
    await page.waitForSelector('h1');
    await ss('11-accounts');
  });

  await check('Activity page loads', async () => {
    await page.click('a[href="/activity"]');
    await page.waitForURL(`${BASE}/activity`);
    await page.waitForSelector('h1');
    await ss('12-activity');
  });

  await check('Expenses page loads with summary stats', async () => {
    await page.click('a[href="/expenses"]');
    await page.waitForURL(`${BASE}/expenses`);
    await page.waitForSelector('h1:has-text("Expenses")');
    await page.waitForSelector('text=Loading…', { state: 'detached' });
    await page.waitForSelector('text=Total approved spend');
    await page.waitForSelector('text=All transactions');
    await ss('13-expenses');
  });

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log('\n=== TEST RESULTS ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log('Screenshots: /tmp/demo-screenshots/');
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
