// Dedicated integration check for the METHODS WORKSPACE:
//   Library -> Paper -> Methods, answering "What did the authors actually
//   do?" from already-extracted evidence — organized, located, quoted,
//   never recommended or judged.
//
// Drives the REAL app in headless Chrome against a REAL backend started
// by this script on an ISOLATED copy of the dev DB (never
// data/lit_review.db). No extraction/synthesis is ever triggered — the
// check only reads (fixture data is static), and it never clicks any
// Extract/Re-run button (the enabled/disabled state is asserted instead).
//
//   node methods_check.mjs        (Vite dev server must be on :8443)
//
// Backend:   LIT_REVIEW_DB=/tmp/liit_methods_check.db (VACUUM INTO copy)
// Screenshots: /tmp/liit_methods_*.png     Exit 1 on any failed check.
//
// The 13 checks mirror the slice's validation plan: open an extracted
// paper, Methods sections + provenance + verbatim source text,
// author-stated labeling, navigation to Evidence/Full Text/Synthesis,
// honest not-analyzed/partial states, no recommendation language, no
// console errors.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import net from 'node:net';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const SRC_DB = `${REPO}/data/lit_review.db`;
const DST_DB = '/tmp/liit_methods_check.db';

// Fixture papers (static, read-only): rich extraction vs never analyzed.
const RICH = 'paper_8f3b051f';        // 122 evidence items, partial (13/15)
const META_ONLY = 'paper_ee34bb23';   // discovered, metadata only, no evidence
const NEVER_RUN = 'paper_ff3962b4';   // 26 chunks, extraction never run
const RICH_TITLE = 'history_dependent_biases';
const METHOD_CATS = [
  'task', 'population_or_dataset', 'stimuli', 'experimental_procedure',
  'variables', 'methods', 'computational_methods', 'statistical_methods',
  'limitations',
];
const SECTION_LABELS = [
  'Study / experimental task', 'Participants / population / dataset',
  'Stimuli / materials', 'Experimental design / procedure',
  'Measures / variables', 'Methods', 'Computational methods / models',
  'Statistical methods', 'Reported limitations (author-stated)',
];
// Verified absent from ALL fixture method-category texts AND from every
// string the Methods UI itself generates — the scan targets LiiT's
// language, and any hit would be LiiT overstepping.
const BANNED = [
  'recommend', 'should read', 'should use', 'best method', 'more relevant',
  'research gap', 'we suggest', 'better than', 'ought to', 'relevant',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageErrors = [];
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures += 1;
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

/** Click a paper-detail tab (scoped to tab-bar buttons so the "Methods"
 *  sidebar nav button with the same label is never hit). */
async function clickTab(page, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate((l) => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /\btab-(active|inactive)\b/.test(String(b.className))
        && (b.textContent || '').trim() === l);
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    if (ok) return;
    if (Date.now() >= deadline) throw new Error(`tab not found: ${label}`);
    await sleep(250);
  }
}

async function clickNav(page, label) {
  await page.evaluate((l) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      /\bnav-item-(active|inactive)\b/.test(String(b.className))
      && (b.textContent || '').trim() === l);
    if (btn) btn.click();
  }, label);
}

async function tabActive(page, label) {
  return pollUntil(page, (l) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      /\btab-(active|inactive)\b/.test(String(b.className))
      && (b.textContent || '').trim() === l);
    return !!(btn && String(btn.className).includes('tab-active'));
  }, label, 10000);
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_methods_${name}.png` });
}

async function api(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(false));
    s.once('error', () => done(true));
    s.setTimeout(1500, () => done(true));
  });
}

async function waitHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) return true;
    } catch {}
    if (Date.now() >= deadline) return false;
    await sleep(300);
  }
}

let backend = null;
const backendLog = [];
// Any early exit must never leave the spawned backend alive — a stale
// uvicorn on :8000 would block the next run with "port in use".
process.on('exit', () => {
  try { backend?.kill('SIGKILL'); } catch {}
});

async function main() {
  // ---------- isolated environment ----------
  if (!(await portFree(8000))) {
    console.error('FAIL  port 8000 is in use — stop the running backend so this check can start its own isolated one');
    process.exit(1);
  }
  const viteOk = await fetch(BASE).then(r => r.ok).catch(() => false);
  if (!viteOk) {
    console.error('FAIL  Vite dev server not answering on :8443 — start it (npm run dev in Liit/) and re-run');
    process.exit(1);
  }

  rmSync(DST_DB, { force: true });
  execSync(`sqlite3 "${SRC_DB}" "VACUUM INTO '${DST_DB}'"`);  // consistent snapshot incl. WAL
  console.log(`MODE: isolated DB copy -> ${DST_DB} (source never opened for write)`);

  backend = spawn(`${REPO}/.venv/bin/python`,
    ['-m', 'uvicorn', 'backend.app.main:app', '--port', '8000'],
    { cwd: REPO, env: { ...process.env, LIT_REVIEW_DB: DST_DB },
      stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout.on('data', d => backendLog.push(String(d)));
  backend.stderr.on('data', d => backendLog.push(String(d)));
  if (!(await waitHealth(30000))) {
    console.error('FAIL  backend never became healthy:\n' + backendLog.join('').slice(-2000));
    process.exit(1);
  }

  // Fixture canary: proves this backend is on the fixture copy AND the
  // new read-only status endpoint reports the known truth.
  const canary = await api(`/api/papers/${RICH}/extraction-status`);
  if (canary.run !== 'partial' || canary.succeeded !== 13 || canary.failed !== 2) {
    console.error(`FAIL  fixture canary: unexpected extraction-status ${JSON.stringify(canary)}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      pageErrors.push(msg.text());
    }
  });

  try {
    // ---------- open the rich paper via the real UI ----------
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await waitFor(page, 'Projects', 30000);
    await clickNav(page, 'Projects');
    await waitFor(page, 'Each project holds its own papers', 30000);
    await clickText(page, 'button', 'synthesis-validation');
    await waitFor(page, RICH_TITLE, 30000);
    await clickText(page, 'button', RICH_TITLE);

    const evAll = await api(`/api/papers/${RICH}/evidence`);
    const chunksApi = await api(`/api/papers/${RICH}/chunks`);
    const chunkIds = new Set(chunksApi.map(c => c.chunk_id));
    const methodCount = evAll.filter(e => METHOD_CATS.includes(e.category)).length;

    // ---- 1. open a paper with completed extraction ----
    const opened = await waitFor(page, RICH_TITLE, 30000);
    check('1. opens a paper with completed extraction', opened && evAll.length > 0,
      `evidence=${evAll.length}`);
    await shot(page, '01_paper_overview');

    // ---- 2. open Methods; header count matches the API ----
    await clickTab(page, 'Methods');
    const headerOk = await pollUntil(page, (n) =>
      new RegExp(`Method evidence · ${n} items`).test(document.body.textContent || ''),
    methodCount, 15000);
    check('2. Methods tab opens; header count matches the API', headerOk,
      `expected ${methodCount} items`);
    await shot(page, '02_methods_sections');

    // ---- 3. Methods information displayed by category ----
    const headings = await page.evaluate((labels) => {
      const h = Array.from(document.querySelectorAll('h4'))
        .map(e => (e.textContent || '').trim());
      return labels.filter(l => h.includes(l)).length;
    }, SECTION_LABELS);
    const sampleOk = await waitFor(page, 'Two-sided permutation test', 10000);
    check('3. Methods information is displayed by category',
      headings >= 6 && sampleOk, `sections=${headings}/9`);

    // ---- 4. valid source provenance from real fields ----
    const provRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.method-item')).map(el => ({
        id: el.getAttribute('data-ev-id') || '',
        text: (el.querySelector('.provenance-line')?.textContent || '').trim(),
      })));
    let provOk = false;
    let provNote = '';
    for (const row of provRows) {
      const m = row.text.match(/^(.+?) · (SOURCE LOCATION UNKNOWN|p{1,2}\. \d+(?:–\d+)?) · ([a-z_0-9]+)$/);
      if (!m) continue;
      const ev = evAll.find(e => e.id === row.id);
      if (!ev || m[3] !== ev.chunk_id || !chunkIds.has(m[3])) continue;
      if (ev.location_status !== 'known' || ev.page_start == null) {
        if (m[2] !== 'SOURCE LOCATION UNKNOWN') continue;
      } else if (!m[2].includes(String(ev.page_start))) {
        continue;
      }
      provOk = true;
      provNote = `${m[1]} · ${m[2]} · ${m[3]}`;
      break;
    }
    const unknownOk = await waitFor(page, 'SOURCE LOCATION UNKNOWN', 10000);
    check('4. source provenance from real fields (SOURCE LOCATION UNKNOWN honored)',
      provOk && unknownOk, provNote || 'no provenance line matched API fields');
    await shot(page, '04_provenance');

    // ---- 5. expandable verbatim source text vs extracted information ----
    const target = evAll.find(e => METHOD_CATS.includes(e.category) && chunkIds.has(e.chunk_id));
    const expandRes = await page.evaluate((id) => {
      const card = document.querySelector(`.method-item[data-ev-id="${id}"]`);
      if (!card) return 'no-card';
      const btn = Array.from(card.querySelectorAll('button'))
        .find(b => (b.textContent || '').includes('Show source text'));
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    }, target.id);
    const srcShown = await pollUntil(page, (id) => {
      const card = document.querySelector(`.method-item[data-ev-id="${id}"]`);
      return !!(card && card.querySelector('.source-text-block'));
    }, target.id, 10000);
    const texts = await page.evaluate((id) => {
      const card = document.querySelector(`.method-item[data-ev-id="${id}"]`);
      return {
        extracted: card?.querySelector('.extracted-text')?.textContent ?? '',
        source: card?.querySelector('.source-text-block')?.textContent ?? '',
        labels: card?.textContent ?? '',
      };
    }, target.id);
    const chunkText = chunksApi.find(c => c.chunk_id === target.chunk_id)?.text ?? '';
    check('5. source text expands verbatim; EXTRACTED INFORMATION vs SOURCE TEXT',
      expandRes === 'clicked' && srcShown
        && texts.extracted === target.text
        && texts.source === chunkText
        && texts.labels.includes('EXTRACTED INFORMATION')
        && texts.labels.includes('SOURCE TEXT'),
      `ev=${target.id.slice(0, 46)}`);
    await shot(page, '05_source_text');

    // ---- 6. author-stated comparisons labeled + attributed ----
    const statedShown = await pollUntil(page, () => {
      const t = document.body.textContent || '';
      return t.includes('AUTHOR-STATED — comparisons, trade-offs & rationale')
        && t.includes('belong to its authors');
    }, null, 10000);
    const chips = await page.evaluate(() => Array.from(document.querySelectorAll('span'))
      .filter(s => (s.textContent || '').trim() === 'AUTHOR-STATED').length);
    check('6. author-stated comparisons labeled and attributed', statedShown && chips >= 2,
      `chips=${chips}`);
    const paperMethodsText = await page.evaluate(() => document.body.textContent || '');
    await shot(page, '06_author_stated');

    // ---- 7. navigate to Evidence (linked item highlighted) ----
    const openedEv = await page.evaluate((id) => {
      const card = document.querySelector(`.method-item[data-ev-id="${id}"]`);
      const btn = card && Array.from(card.querySelectorAll('button'))
        .find(b => (b.textContent || '').includes('Open in Evidence'));
      if (!btn) return false;
      btn.click();
      return true;
    }, target.id);
    const onEvidence = await tabActive(page, 'Evidence');
    const highlighted = await pollUntil(page, (id) => {
      const el = document.querySelector(`[data-ev-id="${id}"]`);
      return !!(el && el.dataset.highlight === '1' && el.style.outline);
    }, target.id, 10000);
    check('7. navigation to Evidence works (linked item highlighted)',
      openedEv && onEvidence && highlighted, target.id.slice(0, 40));
    await shot(page, '07_evidence_highlight');

    // ---- 8. navigate to Full Text ----
    const sectionsApi = await api(`/api/papers/${RICH}/sections`);
    const sec0 = sectionsApi.find(s => (s.items || []).some(it => it.text.trim()));
    const fullSample = sec0.items.find(it => it.text.trim()).text.slice(0, 60);
    await clickTab(page, 'Full Text');
    const onFull = await tabActive(page, 'Full Text');
    const fullShown = await waitFor(page, fullSample, 15000);
    check('8. navigation to Full Text works', onFull && fullShown, sec0.name);
    await shot(page, '08_full_text');

    // ---- 9. navigate to Synthesis ----
    const syn = await api(`/api/papers/${RICH}/synthesis`).catch(() => null);
    await clickTab(page, 'Synthesis');
    const onSyn = await tabActive(page, 'Synthesis');
    const synLabel = syn && syn.synthesis_status === 'complete'
      ? await waitFor(page, 'Regenerate synthesis', 15000) : !!syn;
    const field = syn ? Object.entries(syn.synthesis)
      .find(([, items]) => items.length > 0)?.[0] : null;
    const fieldOk = field
      ? await waitFor(page, field.replace(/_/g, ' '), 10000) : !!syn;
    check('9. navigation to Synthesis works',
      !!syn && onSyn && synLabel && fieldOk,
      syn ? `${syn.synthesis_status}${field ? ` field=${field}` : ''}` : 'synthesis missing');
    await shot(page, '09_synthesis');

    // ---- 10. papers without extraction: honest not-analyzed states ----
    await clickText(page, 'button', '← Library');
    await waitFor(page, 'Upload PDF', 15000);
    await clickText(page, 'button', 'Quantum Mpemba');
    await clickTab(page, 'Methods');
    const metaState = await waitFor(page,
      'Method extraction has not been performed for this paper.', 15000);
    const badgeOk = await waitFor(page, 'Metadata only — PDF not available', 10000);
    const disabledOk = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => (x.textContent || '').trim() === 'Extract evidence');
      return !!b && b.disabled;   // never auto-started; action honestly disabled
    });
    await shot(page, '10a_metadata_only');

    await clickText(page, 'button', '← Library');
    await clickNav(page, 'Projects');
    await waitFor(page, 'Each project holds its own papers', 15000);
    await clickText(page, 'button', 'knowledge-validation');
    await waitFor(page, 'UNSET', 15000);
    await clickText(page, 'button', 'UNSET');
    await clickTab(page, 'Methods');
    const notRunState = await waitFor(page,
      'Method extraction has not been run for this paper.', 15000);
    const enabledOk = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => (x.textContent || '').trim() === 'Extract evidence');
      return !!b && !b.disabled;  // on-demand action offered, not launched
    });
    const neverRunApi = await api(`/api/papers/${NEVER_RUN}/extraction-status`);
    check('10. papers without extraction show honest not-analyzed states',
      metaState && badgeOk && disabledOk && notRunState && enabledOk
        && neverRunApi.run === 'not_run',
      `metabadge=${badgeOk} never-run=${neverRunApi.run}`);
    await shot(page, '10b_never_run');

    // ---- 11. partial extraction: truthful banner, no crash ----
    await clickText(page, 'button', '← Library');
    await clickNav(page, 'Projects');
    await waitFor(page, 'Each project holds its own papers', 15000);
    await clickText(page, 'button', 'synthesis-validation');
    await waitFor(page, RICH_TITLE, 15000);
    await clickText(page, 'button', RICH_TITLE);
    await clickTab(page, 'Methods');
    const richStatus = await api(`/api/papers/${RICH}/extraction-status`);
    const banner = `Extraction partial — ${richStatus.succeeded}/${richStatus.chunks_total}`
      + ` chunks succeeded · ${richStatus.failed} failed`;
    const bannerOk = await waitFor(page, banner, 15000);
    const stillRenders = await waitFor(page, 'Two-sided permutation test', 10000);
    check('11. partial extraction shows a truthful banner without crashing',
      bannerOk && stillRenders && richStatus.run === 'partial', banner);
    await shot(page, '11_partial_banner');

    // ---- 12. no recommendation language (paper Methods + Methods index) ----
    await clickNav(page, 'Methods');   // sidebar index (nav-scoped click)
    const indexShown = await waitFor(page,
      'Open a paper to see what the authors actually did', 15000);
    const countShown = await waitFor(page, `${methodCount} method items`, 15000);
    const emptyCountShown = await waitFor(page, 'Not extracted', 10000);
    const sidebarText = await page.evaluate(() => document.body.textContent || '');
    const hits = BANNED.filter(w =>
      `${paperMethodsText} ${sidebarText}`.toLowerCase().includes(w));
    // index row opens the paper directly on the Methods tab
    await clickText(page, 'button', RICH_TITLE);
    const directOpen = await tabActive(page, 'Methods')
      && await waitFor(page, `Method evidence · ${methodCount} items`, 15000);
    check('12. no recommendation language (paper Methods + Methods index)',
      indexShown && countShown && emptyCountShown && hits.length === 0 && directOpen,
      hits.length ? `banned: ${hits.join(',')}` : 'clean');
    await shot(page, '12_methods_index');

    // ---- 13. no console / page errors ----
    check('13. no console or page errors', pageErrors.length === 0,
      pageErrors.slice(0, 2).join(' | '));

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`
      + ` — screenshots: /tmp/liit_methods_*.png`);
  } finally {
    await browser.close().catch(() => {});
    if (backend) {
      backend.kill('SIGTERM');
      await sleep(500);
      try { backend.kill('SIGKILL'); } catch {}
    }
    if (failures === 0) rmSync(DST_DB, { force: true });
  }
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error(`CHECK CRASHED: ${e.message}`);
    if (backendLog.length) {
      console.error('--- backend log tail ---\n' + backendLog.join('').slice(-1500));
    }
    if (backend) { try { backend.kill('SIGKILL'); } catch {} }
    process.exit(1);
  });
