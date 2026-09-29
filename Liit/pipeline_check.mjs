// Manual integration check for the paper-analysis pipeline UI slice.
// Drives the REAL app in headless Chrome against the REAL backend:
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
// (backend runs on an isolated copy of the dev DB, LIT_REVIEW_DB).
// Verifies: analysis status display, embedding run + landscape refresh,
// synthesis generation + provenance view, extraction re-run stats,
// disabled actions for metadata-only papers, and a visible failure state.
// Screenshots: /tmp/liit_pipeline_*.png   Exit 1 on any failed check.
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8443/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageErrors = [];
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures += 1;
}

async function body(page) {
  return page.evaluate(() => document.body.textContent || '');
}

async function pollUntil(page, fn, arg, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch {}
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
}

async function waitFor(page, substr, timeout = 30000) {
  return pollUntil(page, (s) => (document.body.textContent || '').includes(s), substr, timeout);
}

/** Click the nth matching target, waiting for it to render first (rows and
 * detail panes render on independent fetches — a one-shot click can race). */
async function clickText(page, tag, text, nth = 0, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate((t, s, n) => {
      const els = Array.from(document.querySelectorAll(t))
        .filter((e) => (e.textContent || '').trim().includes(s));
      if (!els[n]) return false;
      els[n].scrollIntoView();
      els[n].click();
      return true;
    }, tag, text, nth);
    if (ok) return;
    if (Date.now() >= deadline) {
      throw new Error(`click target missing: <${tag}> "${text}" #${nth}`);
    }
    await sleep(250);
  }
}

async function disabled(page, tag, text) {
  return page.evaluate((t, s) => {
    const el = Array.from(document.querySelectorAll(t))
      .find((e) => (e.textContent || '').trim().includes(s));
    if (!el) return 'missing';
    return el.disabled === true;
  }, tag, text);
}

async function hasButton(page, text) {
  return page.evaluate((s) => Array.from(document.querySelectorAll('button'))
    .some((b) => (b.textContent || '').trim().includes(s)), text);
}

/** Wait until the paper-detail header (h2) shows this title — avoids
 * passing on stale body text from the previously open view/panel. */
async function waitForTitle(page, text, timeout = 20000) {
  return pollUntil(
    page,
    (s) => (document.querySelector('h2')?.textContent || '').includes(s),
    text, timeout);
}

/** True iff a button with this label is observed in its disabled (busy)
 * state at any point within `ms` (fast polling — ops can be quick). */
async function sawDisabled(page, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await page.evaluate((s) => {
      const el = Array.from(document.querySelectorAll('button'))
        .find((e) => (e.textContent || '').trim().includes(s));
      if (!el) return 'missing';
      return el.disabled ? 'disabled' : 'enabled';
    }, label);
    if (r === 'disabled') return true;
    await sleep(20);
  }
  return false;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      pageErrors.push(`console: ${m.text()}`);
    }
  });
  try {
    await run(page);
  } catch (e) {
    await page.screenshot({ path: '/tmp/liit_pipeline_fail.png' });
    const dump = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll('button'))
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)),
      body: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 600),
    }));
    console.error('FAILURE DUMP:', JSON.stringify(dump, null, 1));
    await browser.close();
    console.error('CHECK SCRIPT FAILED:', e.message);
    process.exit(1);
  }
  await browser.close();
  check('no JS/console errors during the run', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function run(page) {

  // ---- 1. Open LiiT, open the ingested paper ----
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  check('library lists the project papers',
    await waitFor(page, 'history_dependent_biases_in_perceptual_decisions', 20000));
  await clickText(page, 'button', 'history_dependent_biases_in_perceptual_decisions');
  check('paper detail shows the analysis pipeline',
    await waitFor(page, 'Analysis pipeline', 20000));
  check('detail opened the right paper',
    await waitForTitle(page, 'history_dependent_biases_in_perceptual_decisions', 10000));
  await sleep(1200);
  await page.screenshot({ path: '/tmp/liit_pipeline_1_analysis.png' });

  const t1 = await body(page);
  check('processing row reports real chunk/section counts',
    /chunks · \d+ sections/.test(t1));
  check('evidence row reports real evidence count',
    /\d+ evidence items/.test(t1));
  check('synthesis row reports the stored complete synthesis',
    t1.includes('fields populated') && t1.includes('Open Synthesis'));
  check('embedding row reports pending (not yet generated)',
    t1.includes('Not generated yet'));

  // ---- 2. Update embedding -> similarity -> landscape refresh ----
  await clickText(page, 'button', 'Update embedding');
  check('embedding run completes (new vector or hash-skip)',
    await waitFor(page, 'Last embedding run: complete', 180000), 'timeout 180s');
  // The stats line comes from the POST response; the row's `384d · model`
  // text comes from the refresh() that follows — poll for it, don't race it.
  await waitFor(page, '384d · sentence-transformers/all-MiniLM-L6-v2', 30000);
  const t2 = await body(page);
  check('embedding row now reports the stored 384d vector',
    t2.includes('384d · sentence-transformers/all-MiniLM-L6-v2'));
  check('open-landscape link offered after embedding',
    t2.includes('Open Landscape'));
  await page.screenshot({ path: '/tmp/liit_pipeline_2_embedded.png' });

  await clickText(page, 'button', 'Open Landscape');
  check('landscape renders nodes',
    await page.waitForFunction(
      () => document.querySelectorAll('.graph-node').length >= 1,
      { timeout: 20000 }));
  await sleep(800);
  const edges = await page.evaluate(
    () => document.querySelectorAll('svg.graph-area line').length);
  check('landscape shows the semantic-similarity edge for the new embedding',
    edges >= 1, `${edges} graph line(s)`);
  await page.evaluate(() => {
    const n = document.querySelector('.graph-node');
    if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  check('node detail panel opens', await waitFor(page, 'Selected paper', 10000));
  await page.screenshot({ path: '/tmp/liit_pipeline_3_landscape.png' });

  // ---- 3. Metadata-only paper: actions correctly withheld/disabled ----
  await clickText(page, 'button', 'Library');
  check('library sidebar switch lands on the Library view',
    await waitFor(page, 'Upload PDF', 20000));
  await waitFor(page, 'Quantum Mpemba', 20000);
  await clickText(page, 'button', 'Quantum Mpemba');
  check('metadata-only analysis row shown',
    await waitForTitle(page, 'Quantum Mpemba', 20000));
  check('analysis row reports the missing PDF honestly',
    await waitFor(page, 'no PDF attached', 10000));
  check('extract disabled without chunks/PDF',
    (await disabled(page, 'button', 'Extract evidence')) === true);
  check('synthesis disabled without evidence',
    (await disabled(page, 'button', 'Generate synthesis')) === true);
  check('no process action for a paper without a stored PDF',
    !(await hasButton(page, 'Process paper')));
  check('attach-PDF action offered instead',
    await hasButton(page, 'Attach PDF to this paper'));
  await page.screenshot({ path: '/tmp/liit_pipeline_4_metaonly.png' });

  // ---- 4. Second project: generate synthesis from existing evidence ----
  await clickText(page, 'button', 'Projects');
  await waitFor(page, 'knowledge-validation', 10000);
  await clickText(page, 'button', 'knowledge-validation');
  check('second project library list loads',
    await waitFor(page, 'History-dependent Biases in Perceptual Decisions Depend on NMDA', 20000));
  await clickText(page, 'button', 'History-dependent Biases in Perceptual Decisions Depend on NMDA');
  check('second paper analysis row shown',
    await waitForTitle(page, 'History-dependent Biases in Perceptual Decisions Depend on NMDA', 20000));
  await sleep(1000);
  const t3 = await body(page);
  check('synthesis not generated yet (button says Generate)',
    t3.includes('Not generated yet') && t3.includes('Generate synthesis'));
  check('evidence already present',
    /\d+ evidence items/.test(t3));
  await page.screenshot({ path: '/tmp/liit_pipeline_5_before_synth.png' });

  await clickText(page, 'button', 'Generate synthesis');
  check('synthesis generation completes',
    await waitFor(page, 'Last synthesis run:', 600000), 'timeout 600s');
  const t4 = await body(page);
  const synthLine = /Last synthesis run: (\w+)/.exec(t4);
  check('synthesis run reported complete', synthLine?.[1] === 'complete',
    synthLine?.[1] ?? 'no line');
  await page.screenshot({ path: '/tmp/liit_pipeline_6_synth_done.png' });

  await clickText(page, 'button', 'Open Synthesis');
  check('structured synthesis rendered with field headings',
    await waitFor(page, 'research question', 10000)
    || await waitFor(page, 'main results', 10000));
  const t5 = await body(page);
  check('synthesis provenance (source location) rendered',
    /\bp\.\d+/.test(t5) || t5.includes('SOURCE LOCATION UNKNOWN'));
  await page.screenshot({ path: '/tmp/liit_pipeline_7_synthesis.png' });

  // ---- 5. Re-run extraction (idempotent: retries only failed chunks) ----
  await clickText(page, 'button', 'Overview');
  await waitFor(page, 'Analysis pipeline', 10000);
  await clickText(page, 'button', 'Re-run extraction');
  check('extraction action shows a busy state (duplicate action disabled)',
    await sawDisabled(page, 'Extracting…', 8000), 'polled 8s');
  check('extraction run reports stats',
    await waitFor(page, 'Last extraction run:', 900000), 'timeout 900s');
  const t6 = await body(page);
  const extLine = /Last extraction run: (\w+) · (\d+)\/(\d+) chunks \((\d+) already cached\)/.exec(t6);
  check('extraction stats parsed (status/succeeded/cached)',
    extLine !== null, extLine ? extLine[0] : 'no line');
  await page.screenshot({ path: '/tmp/liit_pipeline_8_extract.png' });

  // ---- 6. Failure state: stored PDF missing -> visible error, retry ----
  await clickText(page, 'button', 'UNSET');
  check('failure-case paper opens', await waitForTitle(page, 'UNSET', 20000));
  await clickText(page, 'button', 'Re-run processing');
  check('backend failure surfaces as a visible error (no silent no-op)',
    await waitFor(page, 'stored PDF missing', 30000), 'timeout 30s');
  await page.screenshot({ path: '/tmp/liit_pipeline_9_error.png' });

  check('no JS/console errors during the run', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) throw new Error(`${failures} check(s) failed`);
}

main().catch((e) => {
  console.error('CHECK SCRIPT FAILED:', e.message);
  process.exit(1);
});
