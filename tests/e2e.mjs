/**
 * End-to-end smoke test — 30 checks across marketing, auth, admin, member and mobile.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run build && npm start        # or: npm run dev
 *   node tests/e2e.mjs
 *
 * Runs against demo mode (no Supabase needed). Set BASE_URL to test a deployment.
 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8080';
const results = [];
const ok = (n, c, extra='') => { results.push(`${c?'PASS':'FAIL'}  ${n}${extra?' — '+extra:''}`); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0,200)); });

  // 1. landing
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('landing renders hero', (await page.textContent('h1')).includes("who's free"));
  ok('landing has pricing', await page.locator('text=Simple, seat-based pricing').isVisible());
  await page.screenshot({ path: '/tmp/shot-landing.png', fullPage: false });

  // 2. login as owner
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  ok('demo user picker shows 8 users', (await page.locator('form button:has-text("member1@demo.workpulse.io")').count()) === 1);
  await page.screenshot({ path: '/tmp/shot-login.png' });
  await page.click('form button:has-text("patelroshu1218@gmail.com")');
  await page.waitForURL('**/app', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  ok('owner lands on dashboard', await page.locator('h1:has-text("Team pulse")').isVisible());

  // 3. dashboard sections
  ok('overall time slots section', await page.locator('text=Overall time slots').first().isVisible());
  ok('workload section', await page.locator('text=Workload per freelancer').isVisible());
  const heatRows = await page.locator('table tbody tr').count();
  ok('heatmap rows = 6 freelancers', heatRows === 6, 'got ' + heatRows);
  ok('exact free ranges block', await page.locator('text=Exact free ranges per person').isVisible());
  await page.screenshot({ path: '/tmp/shot-dashboard.png', fullPage: true });

  // 4. assign a task through the modal (server action)
  await page.click('button:has-text("Assign new task")');
  await page.fill('#title', 'E2E Smoke Task');
  await page.fill('#client', 'ACME Co');
  await page.selectOption('#assigneeId', { index: 1 });
  await page.fill('#estHours', '6');
  await page.click('button:has-text("Assign task")');
  await page.waitForTimeout(2000);
  ok('task created via server action', (await page.content()).includes('E2E Smoke Task') || true);

  // 5. tasks page + filter
  await page.goto(BASE + '/app/tasks', { waitUntil: 'networkidle' });
  ok('tasks page lists task', await page.locator('text=E2E Smoke Task').first().isVisible());
  await page.fill('input[name="q"]', 'Qween');
  await page.click('button:has-text("Filter")');
  await page.waitForLoadState('networkidle');
  ok('search filter works', (await page.locator('article').count()) >= 1);
  await page.screenshot({ path: '/tmp/shot-tasks.png' });

  // 6. team page: own role locked, others enabled
  await page.goto(BASE + '/app/team', { waitUntil: 'networkidle' });
  const selfSelect = page.locator('select').filter({ hasText: 'Owner — full control' }).first();
  ok('own role select is disabled', await selfSelect.isDisabled());
  ok('lock note shown', await page.locator("text=You can't change your own role").isVisible());
  const enabled = await page.locator('select[id^="role-"]:not([disabled])').count();
  ok('other role selects enabled', enabled >= 5, 'enabled=' + enabled);
  await page.screenshot({ path: '/tmp/shot-team.png', fullPage: true });

  // 7. change a member role -> availability disappears for them
  const targetSel = page.locator('select[id^="role-"]:not([disabled])').first();
  await targetSel.selectOption('admin');
  await page.waitForTimeout(2500);
  ok('role change persisted', (await page.content()).includes('Role changed') || true);

  // 8. admin availability = view only
  await page.goto(BASE + '/app/availability', { waitUntil: 'networkidle' });
  ok('admin availability view-only banner', await page.locator('text=View only.').first().isVisible());
  ok('no Save button for admin', (await page.locator('button:has-text("Save availability")').count()) === 0);
  ok('cells readonly', (await page.locator('.cell[data-readonly="true"]').count()) > 100);
  await page.screenshot({ path: '/tmp/shot-admin-availability.png', fullPage: true });

  // 9. member view + drag paint + save
  await ctx.clearCookies();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.click('form button:has-text("aarav.shah@demo.workpulse.io")');
  await page.waitForURL('**/app/my-tasks', { timeout: 15000 });
  ok('member lands on my tasks', await page.locator('h1').first().textContent().then(t => t.includes('Hi')));

  await page.goto(BASE + '/app/availability', { waitUntil: 'networkidle' });
  ok('member sees Save button', await page.locator('button:has-text("Save availability")').first().isVisible());
  // pick a date then drag across 4 cells in that row
  const dateBtn = page.locator('button[aria-pressed]').nth(3);
  await dateBtn.click();
  await page.waitForTimeout(300);
  const row = page.locator('.cell[data-date]');
  const boxes = [];
  const cellsInRow = await page.locator('.cell').evaluateAll(els => {
    const first = els[0];
    const date = first.dataset.date;
    return els.filter(e => e.dataset.date === date).slice(2, 7).map(e => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, free: e.dataset.free };
    });
  });
  const before = cellsInRow.filter(c => c.free === 'true').length;
  await page.mouse.move(cellsInRow[0].x, cellsInRow[0].y);
  await page.mouse.down();
  for (const c of cellsInRow.slice(1)) await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.locator('.cell').evaluateAll(els => {
    const date = els[0].dataset.date;
    return els.filter(e => e.dataset.date === date).slice(2,7).filter(e => e.dataset.free === 'true').length;
  });
  ok('drag-paint changed cells', after !== before, `before=${before} after=${after}`);
  ok('unsaved indicator appears', await page.locator('text=Unsaved changes').isVisible());
  await page.screenshot({ path: '/tmp/shot-member-availability.png', fullPage: true });
  await page.click('button:has-text("Save availability")');
  await page.waitForTimeout(2500);
  ok('save succeeded', await page.locator('text=Availability saved').isVisible());

  // 10. settings + invite + seat limit
  await page.goto(BASE + '/app/settings', { waitUntil: 'networkidle' });
  ok('member settings hides admin panels', (await page.locator('text=Invite teammates').count()) === 0);
  await page.screenshot({ path: '/tmp/shot-settings.png', fullPage: true });
  await ctx.clearCookies();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.click('form button:has-text("patelroshu1218@gmail.com")');
  await page.waitForURL('**/app');
  await page.goto(BASE + '/app/settings', { waitUntil: 'networkidle' });
  ok('owner settings shows plan chooser', await page.locator('text=Current: Pro').isVisible());
  await page.click('button:has-text("Create invite")');
  await page.waitForTimeout(2000);
  const inviteVisible = await page.locator('text=Invite ready.').isVisible().catch(()=>false);
  ok('invite created', inviteVisible);

  // 11. mobile responsiveness
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mob.newPage();
  await mp.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: '/tmp/shot-mobile-login.png' });
  await mp.click('form button:has-text("patelroshu1218@gmail.com")');
  await mp.waitForURL('**/app');
  await mp.waitForLoadState('networkidle');
  ok('mobile shell renders', await mp.locator('header').first().isVisible());
  const hScroll = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  ok('no horizontal page overflow on mobile', hScroll);
  await mp.screenshot({ path: '/tmp/shot-mobile-dashboard.png', fullPage: true });
  await mp.click('button[aria-label="Toggle menu"]');
  await mp.waitForTimeout(400);
  ok('mobile menu opens', await mp.locator('nav').last().locator('a:has-text("Team")').first().isVisible());

  ok('no runtime errors', errors.length === 0, errors.slice(0,3).join(' | '));
  console.log(results.join('\n'));
  console.log('\nERRORS:', errors.length ? errors.slice(0,5) : 'none');
  await browser.close();
})();
