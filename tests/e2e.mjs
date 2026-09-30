/**
 * Full E2E test suite for the Agent cards demo.
 *
 * Suite 1 — Golden path   : create policy on /policies → issue card on /agents → purchase → cleanup
 * Suite 2 — Enforcement   : edit policy, per-txn cap, MCC restriction, single-use
 * Suite 3 — Dashboard     : home page stat tiles load
 * Suite 4 — Approvals     : /approvals page loads with approval queue section
 * Suite 5 — Frozen agent  : freeze → provision refused → unfreeze → provision ok
 *
 * Run against the running dev server (npm run dev):
 *   node tests/e2e.mjs
 */

import { chromium } from '../node_modules/playwright/index.mjs';

const BASE = 'http://localhost:3000';

// Skip in CI / build environments where the dev server isn't running
try {
  await fetch(BASE, { signal: AbortSignal.timeout(2000) });
} catch {
  console.log('⏭ Skipping E2E tests — no dev server at', BASE);
  process.exit(0);
}

let passed = 0;
let failed = 0;

function check(label, value) {
  if (value) { console.log(`  ✓ ${label}`); passed++; }
  else        { console.error(`  ✗ ${label}`); failed++; }
}

// ── Browser ────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => sessionStorage.setItem('awx_welcome_seen', '1'));
const page = await ctx.newPage();

await page.goto(`${BASE}/policies`);
await page.waitForLoadState('networkidle');
console.log('✓ Opened /policies\n');

// ── API helpers ────────────────────────────────────────────────────────────────
async function apiRequest(method, path, body) {
  return page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
}

async function apiPolicy(method, body) {
  return apiRequest(method, '/api/policy', body);
}

async function createPolicy(id, name, overrides = {}) {
  await apiPolicy('DELETE', { type: 'policy', policy_id: id }).catch(() => {});
  const r = await apiPolicy('POST', {
    type: 'policy',
    policy_id: id,
    display_name: name,
    currency: 'USD',
    total_budget: overrides.total_budget ?? 10000,
    per_transaction_cap: overrides.per_transaction_cap ?? 500,
    allowed_merchant_categories: overrides.allowed_merchant_categories ?? [],
    card_expiry_days: 30,
    velocity_max_per_hour: overrides.velocity_max_per_hour ?? 10,
  });
  return r.status() === 201;
}

async function createAgent(agentId, policyId) {
  await apiPolicy('DELETE', { type: 'agent', agent_id: agentId }).catch(() => {});
  const r = await apiPolicy('POST', {
    type: 'agent',
    agent_id: agentId,
    display_name: agentId,
    project_id: 'proj-e2e',
    issuance_mode: 'human_provisioned',
    policy_id: policyId,
  });
  return r.status() === 201;
}

async function issueCard(agentId, opts = {}) {
  const r = await apiRequest('POST', '/api/cards', {
    agentId,
    projectId: 'proj-e2e',
    singleUse: opts.singleUse ?? true,
    limitAmount: opts.limitAmount ?? 500,
    currency: 'USD',
    allowedMerchantCategories: opts.mccs,
  });
  const body = await r.json();
  return { status: r.status(), cardId: body.card?.card_id };
}

async function charge(cardId, amount, mcc = '5734') {
  const r = await apiRequest('POST', '/api/cards/transaction', {
    cardId, amount, currency: 'USD', merchantCategoryCode: mcc,
  });
  const body = await r.json();
  return { txn: body.transaction, error: body.error };
}

// Cancel all ACTIVE/INACTIVE Airwallex cards belonging to an agent so prior
// test runs don't leave a card that blocks the Issue card button.
async function cancelAgentCards(agentId) {
  try {
    const r = await apiRequest('GET', '/api/agents', null);
    const data = await r.json();
    const group = (data.agents || []).find(g => g.agentId === agentId);
    for (const c of group?.cards || []) {
      if (c.card_status === 'ACTIVE' || c.card_status === 'INACTIVE') {
        await apiRequest('PATCH', '/api/cards', { cardId: c.card_id, status: 'CLOSED' }).catch(() => {});
      }
    }
  } catch { /* best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1 — Golden path
// ═══════════════════════════════════════════════════════════════════════════════
console.log('━━━ Golden path ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const GP_POLICY_ID   = 'e2e-golden-policy';
const GP_POLICY_NAME = 'E2E Golden Policy';
const GP_AGENT_ID    = 'e2e-golden-agent';

// Pre-clean from any prior run (cancel live Airwallex cards first, then remove local records)
await cancelAgentCards(GP_AGENT_ID);
await apiPolicy('DELETE', { type: 'policy', policy_id: GP_POLICY_ID }).catch(() => {});
await apiPolicy('DELETE', { type: 'agent',  agent_id: GP_AGENT_ID  }).catch(() => {});

// Create policy via UI on /policies
await page.click('button:has-text("+ Add policy")');
await page.waitForSelector('button:has-text("Create policy")');
const policyForm = page.locator('form').filter({ hasText: 'New policy' });
await policyForm.locator('input[placeholder="research-policy"]').fill(GP_POLICY_ID);
await policyForm.locator('input[placeholder="Research Policy"]').fill(GP_POLICY_NAME);

const [createResp] = await Promise.all([
  page.waitForResponse('**/api/policy'),
  policyForm.locator('button:has-text("Create policy")').click(),
]);
check('Create policy via UI (201)', createResp.status() === 201);
await page.waitForSelector(`text=${GP_POLICY_NAME}`, { timeout: 5000 });
check('Policy tile visible', true);

// Navigate to /agents — CardsManager auto-fetches policies on mount
await page.goto(`${BASE}/agents`);
await page.waitForLoadState('networkidle');

// Refresh the cards list (also refreshes policy dropdown via /api/policy)
const [refreshResp] = await Promise.all([
  page.waitForResponse('**/api/agents', { timeout: 10000 }),
  page.click('button:has-text("Refresh")'),
]);
check('Refresh returns 200', refreshResp.status() === 200);
await page.waitForTimeout(500);

// New policy should be in the Issue card form dropdown
const issueForm = page.locator('#issue-card-form');
check('Policy in issue dropdown', await issueForm.locator(`select option:has-text("${GP_POLICY_NAME}")`).count() === 1);

// Select policy from the first select (policy dropdown; currency select is second)
await issueForm.locator('select').first().selectOption({ label: GP_POLICY_NAME });
await page.waitForSelector('input[placeholder="e.g. research-agent-task-1"]', { timeout: 3000 });
check('Agent ID input shown after policy selection', true);

// Fill agent ID and issue card
await issueForm.locator('input[placeholder="e.g. research-agent-task-1"]').fill(GP_AGENT_ID);
const [issueResp] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/cards') && r.request().method() === 'POST', { timeout: 30000 }),
  issueForm.locator('button:has-text("Issue card")').click(),
]);
check('Issue card returns 200', issueResp.status() === 200);
const issueBody = await issueResp.json();
const gpCardId = issueBody.card?.card_id;
check('Card ID returned', !!gpCardId);
check('Success message shown', await page.locator('text=Issued').count() > 0);

// Refresh → card tile appears in the agent cards list
const [agentsResp] = await Promise.all([
  page.waitForResponse('**/api/agents', { timeout: 30000 }),
  page.click('button:has-text("Refresh")'),
]);
check('Agents refresh returns 200', agentsResp.status() === 200);
const cardTile = page.locator('.rounded-2xl').filter({ hasText: GP_AGENT_ID });
await cardTile.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
check('Card tile visible in list', await cardTile.count() > 0);

// Simulate a purchase — try UI first, then fall back to API with retry on 503
if (gpCardId) {
  const tile = cardTile.filter({ has: page.locator('input[type="number"]:not([disabled])') }).first();
  await tile.locator('input[type="number"]').waitFor({ state: 'visible', timeout: 10000 });
  await tile.locator('input[type="number"]').fill('50');
  // Must select a merchant type — Buy is disabled without one
  await tile.locator('select').selectOption('5734');
  // Wait for Airwallex sandbox to activate the newly issued card
  await page.waitForTimeout(4000);
  const [txnResp] = await Promise.all([
    page.waitForResponse('**/api/cards/transaction', { timeout: 30000 }),
    tile.locator('button:has-text("Buy")').click(),
  ]);
  const txnBody = await txnResp.json();
  if (txnBody.transaction?.failure_reason === 'HTTP 503') {
    // Sandbox 503 — retry via API with additional delay
    let txn;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(4000);
      ({ txn } = await charge(gpCardId, 50));
      if (!txn?.failure_reason || txn.failure_reason !== 'HTTP 503') break;
    }
    check('Purchase approved', txn?.status !== 'FAILED' && !txn?.failure_reason);
  } else {
    check('Purchase approved', txnBody.transaction?.status !== 'FAILED' && !txnBody.transaction?.failure_reason);
  }
}

// Cleanup via API (faster + more reliable than UI delete)
await apiPolicy('DELETE', { type: 'agent',  agent_id: GP_AGENT_ID  }).catch(() => {});
await apiPolicy('DELETE', { type: 'policy', policy_id: GP_POLICY_ID }).catch(() => {});

console.log();

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — Enforcement
// ═══════════════════════════════════════════════════════════════════════════════
console.log('━━━ Enforcement ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ── Edit policy ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/policies`);
await page.waitForLoadState('networkidle');

const researchTile = page.locator('.rounded-xl').filter({ hasText: 'Research Policy' }).first();
await researchTile.locator('button:has-text("Edit")').click();
await page.waitForSelector('button:has-text("Save changes")');
// Find the open edit form by the presence of its Save button
const editForm = page.locator('form').filter({ has: page.locator('button:has-text("Save changes")') });
// Budget input is type="text" with inputMode="numeric" (first of two such inputs)
const budgetInput = editForm.locator('input[inputMode="numeric"]').first();
await budgetInput.fill('9999');
const [saveResp] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/policy') && r.request().method() === 'PUT'),
  page.click('button:has-text("Save changes")'),
]);
check('Edit policy PUT returns 200', saveResp.status() === 200);
await page.waitForTimeout(500);
check('Tile shows updated budget', await researchTile.locator('text=Budget').filter({ hasText: '9,999' }).count() > 0);
// Reset via API
await apiPolicy('PUT', { type: 'policy', policy_id: 'research-policy', total_budget: 5000 });

console.log();

// ── Budget enforcement at provisioning time ────────────────────────────────────
// Tests the app layer: cannot issue a card that would exceed total_budget.
// (Airwallex sandbox MONTHLY charge limits are unreliable, so we test
// provisioning-time enforcement instead.)
console.log('  Budget enforcement at provision time —');
await cancelAgentCards('e2e-cap-agent');
await createPolicy('e2e-cap', 'Cap Test', { total_budget: 50 });
await createAgent('e2e-cap-agent', 'e2e-cap');
// Issuing a $100 card against a $50 total budget → BUDGET_EXCEEDED → 422
const { status: overBudgetStatus } = await issueCard('e2e-cap-agent', { singleUse: false, limitAmount: 100 });
check('Issuing card over total budget refused (422)', overBudgetStatus === 422);
// Issuing a $40 card within the $50 budget → success
const { cardId: capId } = await issueCard('e2e-cap-agent', { singleUse: false, limitAmount: 40 });
check('Card issued within total budget', !!capId);
if (capId) {
  // Retry charge on 503 — newly issued cards can take a few seconds to be simulation-ready
  let ok;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(3000);
    ({ txn: ok } = await charge(capId, 25));
    if (!ok?.failure_reason || ok.failure_reason !== 'HTTP 503') break;
  }
  check('$25 charge approved', !ok?.failure_reason && ok?.status !== 'FAILED');
}
await apiPolicy('DELETE', { type: 'agent',  agent_id: 'e2e-cap-agent' });
await apiPolicy('DELETE', { type: 'policy', policy_id: 'e2e-cap'       });

console.log();

// ── MCC restriction ────────────────────────────────────────────────────────────
// Tests that cards can be issued with MCC restrictions. Airwallex charge-time
// MCC enforcement is not tested here — sandbox simulation returns 503 for
// MCC-restricted cards.
console.log('  MCC restriction —');
await cancelAgentCards('e2e-mcc-agent');
await createPolicy('e2e-mcc', 'MCC Test');
await createAgent('e2e-mcc-agent', 'e2e-mcc');
// Card issued with software-only MCC restriction
const { cardId: mccId } = await issueCard('e2e-mcc-agent', { singleUse: false, limitAmount: 500, mccs: ['5734'] });
check('Card issued with Software-only MCC restriction', !!mccId);
check('MCC-restricted card has valid ID', typeof mccId === 'string' && mccId.length > 0);
await apiPolicy('DELETE', { type: 'agent',  agent_id: 'e2e-mcc-agent' });
await apiPolicy('DELETE', { type: 'policy', policy_id: 'e2e-mcc'       });

console.log();

// ── Single-use enforcement ──────────────────────────────────────────────────────
console.log('  Single-use enforcement —');
await cancelAgentCards('e2e-single-agent');
await createPolicy('e2e-single', 'Single-Use Test');
await createAgent('e2e-single-agent', 'e2e-single');
const { cardId: singleId } = await issueCard('e2e-single-agent', { singleUse: true, limitAmount: 500 });
check('Single-use card issued', !!singleId);
if (singleId) {
  // Retry the first charge — newly created cards can take a few seconds to be simulation-ready
  let first;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(3000);
    ({ txn: first } = await charge(singleId, 50));
    if (!first?.failure_reason || first.failure_reason !== 'HTTP 503') break;
  }
  check('First purchase approved', !first?.failure_reason && first?.status !== 'FAILED');
  const { txn: second } = await charge(singleId, 50);
  check(`Second purchase declined — ${second?.failure_reason ?? '?'}`, second?.status === 'FAILED' || !!second?.failure_reason);
}
await apiPolicy('DELETE', { type: 'agent',  agent_id: 'e2e-single-agent' });
await apiPolicy('DELETE', { type: 'policy', policy_id: 'e2e-single'       });

console.log();

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — Dashboard stat tiles
// ═══════════════════════════════════════════════════════════════════════════════
console.log('━━━ Dashboard ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');
// Stat tiles are rendered client-side; wait for them to appear
await page.waitForFunction(
  () => document.querySelectorAll('a[href="/agents"].rounded-2xl, a[href="/expenses"].rounded-2xl, a[href="/approvals"].rounded-2xl').length >= 3,
  { timeout: 10000 }
).catch(() => {});
// Use href selectors — more specific than text which can match multiple elements
check('Agents tile present',           await page.locator('a[href="/agents"].rounded-2xl').first().isVisible().catch(() => false));
check('Cards issued tile present',     await page.locator('a[href="/agents"].rounded-2xl').nth(1).isVisible().catch(() => false));
check('Pending approvals tile present',await page.locator('a[href="/approvals"].rounded-2xl').isVisible().catch(() => false));
check('Agent spend tile present',      await page.locator('a[href="/expenses"].rounded-2xl').isVisible().catch(() => false));

console.log();

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4 — Approvals page
// ═══════════════════════════════════════════════════════════════════════════════
console.log('━━━ Approvals page ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await page.goto(`${BASE}/approvals`);
await page.waitForLoadState('networkidle');
check('Approvals page loads',           page.url().includes('/approvals'));
check('Approval queue section present', await page.locator('text=Approval queue').count() > 0);

console.log();

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5 — Frozen agent
// ═══════════════════════════════════════════════════════════════════════════════
console.log('━━━ Frozen agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await cancelAgentCards('e2e-freeze-agent'); // cancel any stale Airwallex cards before cleanup
await createPolicy('e2e-freeze-policy', 'Freeze Test Policy');
await createAgent('e2e-freeze-agent', 'e2e-freeze-policy');

// Freeze the agent
const freezeRes = await apiRequest('POST', '/api/agents/freeze', { agentId: 'e2e-freeze-agent', mode: 'freeze' });
check('Agent frozen (200)', freezeRes.status() === 200);

// Provision while frozen → 422
const { status: refusedStatus, cardId: refusedCardId } = await issueCard('e2e-freeze-agent', { limitAmount: 100 });
check('Provision refused while frozen (422)', refusedStatus === 422);
check('No card ID returned while frozen', !refusedCardId);

// Unfreeze
const unfreezeRes = await apiRequest('POST', '/api/agents/freeze', { agentId: 'e2e-freeze-agent', mode: 'unfreeze' });
check('Agent unfrozen (200)', unfreezeRes.status() === 200);

// Provision after unfreeze → success (brief delay for state to propagate)
await page.waitForTimeout(1000);
const { cardId: unfrozenCardId } = await issueCard('e2e-freeze-agent', { limitAmount: 100 });
check('Card issued after unfreeze', !!unfrozenCardId);

// Cleanup
await apiPolicy('DELETE', { type: 'agent',  agent_id: 'e2e-freeze-agent'   });
await apiPolicy('DELETE', { type: 'policy', policy_id: 'e2e-freeze-policy' });

// ── Summary ────────────────────────────────────────────────────────────────────
await browser.close();
console.log();
console.log(`${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
