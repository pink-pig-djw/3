// Smoke test: opens dist/index.html in headless Chromium, checks the game boots
// without errors, plays a short run with simulated input and saves screenshots.
//
//   CHROMIUM=/path/to/chrome node tools/smoke-test.cjs [outDir]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const out = process.argv[2] || path.join(__dirname, '..', 'test-output');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 780 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'index.html'));
  await page.waitForFunction(() => window.__metroDash && window.__metroDash.state === 'menu', null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, '1-menu.png') });

  await page.click('#btn-play');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, '2-run.png') });
  const s1 = await page.evaluate(() => ({ state: __metroDash.state, z: __metroDash.player.z, obstacles: __metroDash.level.obstacles.length, coins: __metroDash.level.coins.length }));

  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  // deterministic mechanics check (independent of headless frame rate)
  const mech = await page.evaluate(() => {
    const g = __metroDash, p = g.player;
    g.level.clearRange(p.z + 5, p.z - 80);
    p.y = 0; p.vy = 0; p.grounded = true; p.airT = 0; p.rollT = 0;
    g.onInput('up');
    let maxY = 0;
    for (let i = 0; i < 40; i++) { g.updatePlay(1 / 60); maxY = Math.max(maxY, p.y); }
    const landed = p.grounded;
    g.onInput('down');
    const rolling = p.rollT > 0;
    const calls = g.renderer.info.render.calls, tris = g.renderer.info.render.triangles;
    return { maxY: +maxY.toFixed(2), landed, rolling, calls, tris };
  });
  await page.screenshot({ path: path.join(out, '3-jump.png') });
  await page.waitForTimeout(900);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const lane = await page.evaluate(() => __metroDash.player.lane);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, '4-roll.png') });

  // Fairness: no stretch where all three lanes are walled by trains unless a
  // ramp leads onto one of them.
  const fair = await page.evaluate(() => {
    const g = __metroDash, L = g.level, T = 2.9;
    const problems = [];
    for (let run = 0; run < 30; run++) {
      g.level.reset(0); g.distance = 400 + run * 120; g.diff = Math.min(1, g.distance / 3000); g.speed = 14 + run * 0.5;
      g.player.z = 0;
      for (let k = 0; k < 25; k++) L.spawnPattern(g);
      const trains = L.obstacles.filter((o) => o.kind === 'train' && !o.u);
      const ramps = L.obstacles.filter((o) => o.kind === 'ramp');
      for (let z = -40; z > L.genZ; z -= 0.5) {
        const blocked = [0, 1, 2].map((l) => trains.find((o) => o.lane === l && z <= o.zF && z >= o.zB));
        if (blocked.every(Boolean)) {
          const reachable = blocked.some((o) => ramps.some((r) => r.lane === o.lane && Math.abs(r.zB - o.zF) < 0.01));
          if (!reachable) { problems.push({ run, z, pat: 'all-blocked' }); break; }
        }
      }
    }
    g.startRun();
    return problems;
  });

  // Fast-forward the simulation (no rendering) with invulnerability to shake out
  // generator / physics exceptions over a long run.
  const sim = await page.evaluate(() => {
    const g = __metroDash;
    g.player.invuln = 1e9;
    let maxObs = 0;
    for (let i = 0; i < 60 * 240; i++) {
      g.player.invuln = 1e9;
      if (i % 90 === 0) g.onInput(['left', 'right', 'up', 'down'][Math.floor(Math.random() * 4)]);
      if (i === 600) g.activatePower('jetpack');
      if (i === 3000) g.activatePower('magnet');
      g.updatePlay(1 / 60);
      maxObs = Math.max(maxObs, g.level.obstacles.length);
    }
    return { state: g.state, distance: Math.round(g.distance), speed: g.speed.toFixed(1), coins: g.runCoins, maxObs, score: g.score };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, '5-later.png') });
  await page.evaluate(() => { __metroDash.player.invuln = 0; __metroDash.die('crash'); });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(out, '6-over.png') });
  const over = await page.evaluate(() => __metroDash.state);

  console.log(JSON.stringify({ s1, mech, lane, fair, sim, over }, null, 1));
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
