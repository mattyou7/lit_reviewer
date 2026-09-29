// Dedicated integration check for CONTEXTUAL LEARNING (beta tutor):
//   Read paper -> select text -> Explain -> contextual explanation with
//   the source/paper context still visible. One general explanation
//   mode (the only one the backend supports), bounded context, honest
//   failure states, no recommendations, no history, no auto-trigger.
//
// Drives the REAL app in headless Chrome against a REAL backend started
// by this script on an ISOLATED copy of the dev DB (never
// data/lit_review.db). The tutor fires ONLY when this check explicitly
// clicks Explain/Learn — never on open/upload/parsing/extraction/
// synthesis/discovery — and the exact total request count proves it.
//
//   node learning_check.mjs        (Vite dev server must be on :8443)
//
// Backend:   LIT_REVIEW_DB=/tmp/liit_learning_check.db (VACUUM INTO copy)
// Screenshots: /tmp/liit_learning_*.png     Exit 1 on any failed check.
//
// Controlled failure: the FIRST /api/tutor/explain request is held ~1.6s
// (so the busy state is observable) and then aborted at the network
// layer; the panel must surface the real error and Retry must recover.
// Later requests pass through to the real local teacher model.
//
// The 15 checks mirror the slice's validation plan: open a processed
// paper, open Full Text, select a passage, trigger Explain, confirm the
// request is bound to the correct paper with the selection preserved,
// confirm loading + explanation + provenance display, bounded context,
// close back to the paper, single honest mode, the Methods connection,
// no retained context across papers, no overreach language, no console
// errors.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import net from 'node:net';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const SRC_DB = `${REPO}/data/lit_review.db`;
const DST_DB = '/tmp/liit_learning_check.db';

// Fixture papers (static, read-only).
const RICH = 'paper_8f3b051f';        // partial extraction (13/15), full text
const P2 = 'paper_ff3962b4';          // knowledge-validation, full text, never extracted
const RICH_TITLE = 'history_dependent_biases';
const METHOD_CATS = [
  'task', 'population_or_dataset', 'stimuli', 'experimental_procedure',
  'variables', 'methods', 'computational_methods', 'statistical_methods',
  'limitations',
];
// LiiT's own UI language must never drift into recommendation/overreach
// territory. Only STATIC chrome copy is scanned — never model output
// (that would make the check nondeterministic).
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

/** Click a paper-detail tab (scoped to tab-bar buttons so the same label
 *  in the sidebar nav is never hit). */
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

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_learning_${name}.png` });
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

/** Select the first rendered Full Text paragraph, verbatim, and nudge
 *  the container the same way a real mouse-up would. */
async function selectFirstParagraph(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('[data-ft-root] [data-ft-page]');
    const p = wrap && wrap.querySelector('p');
    if (!p) return null;
    const range = document.createRange();
    range.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return {
      text: s.toString(),
      context: wrap.getAttribute('data-ft-text') || '',
      section: wrap.getAttribute('data-ft-section') || '',
      subsection: wrap.getAttribute('data-ft-sub') || '',
      page: wrap.getAttribute('data-ft-page') || '',
    };
  });
}

const panelShown = (page, t) => pollUntil(page, () => !!document.querySelector('[data-tutor-panel]'), null, t);
const busyShown = (page, t) => pollUntil(page, () => !!document.querySelector('[data-tutor-busy]'), null, t);
const explanationShown = (page, t) => pollUntil(page, () => {
  const el = document.querySelector('[data-tutor-explanation]');
  return !!(el && (el.textContent || '').trim().length > 0);
}, null, t);
const panelClosed = (page, t) => pollUntil(page, () => !document.querySelector('[data-tutor-panel]'), null, t);

async function closePanel(page) {
  await page.evaluate(() => {
    const b = document.querySelector('[data-tutor-close]');
    if (b) b.click();
  });
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

  // Fixture canary: proves this backend is on the fixture copy and the
  // tutor endpoint exists (Phase 1 finding: it was built new this slice).
  const canary = await api(`/api/papers/${RICH}/extraction-status`);
  if (canary.run !== 'partial' || canary.succeeded !== 13 || canary.failed !== 2) {
    console.error(`FAIL  fixture canary: unexpected extraction-status ${JSON.stringify(canary)}`);
    process.exit(1);
  }
  const richSections = await api(`/api/papers/${RICH}/sections`);
  const p2Sections = await api(`/api/papers/${P2}/sections`);
  if (!richSections.length || !p2Sections.length) {
    console.error('FAIL  fixture canary: expected full text on both fixture papers');
    process.exit(1);
  }
  const richTitle = (await api(`/api/papers/${RICH}`)).title;
  const p2Title = (await api(`/api/papers/${P2}`)).title;

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

  // ---- request capture + the one controlled failure ----
  // Every /api/tutor/explain POST is recorded (association/verbatim
  // assertions). Attempt #1 is held ~1.6s (busy state observable) then
  // aborted at the network layer; Retry and all later asks continue.
  const bodies = [];
  let explainCount = 0;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      if (req.method() !== 'POST' || !req.url().includes('/api/tutor/explain')) {
        await req.continue();
        return;
      }
      explainCount += 1;
      const n = explainCount;
      try { bodies.push(JSON.parse(req.postData() || '{}')); } catch { bodies.push({}); }
      if (n === 1) {
        await sleep(1600);                      // busy state window
        await req.abort('failed').catch(() => {});
      } else {
        await req.continue();
      }
    } catch { /* request already handled */ }
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

    // ---- 1. open a processed paper ----
    const opened = await waitFor(page, RICH_TITLE, 30000);
    check('1. opens a processed paper (known partial extraction + evidence)',
      opened && canary.run === 'partial' && evAll.length > 0 && richSections.length > 0,
      `evidence=${evAll.length} sections=${richSections.length}`);
    await shot(page, '01_paper');

    // ---- 2. Full Text opens with real paragraphs ----
    const sec0 = richSections.find(s => (s.items || []).some(it => it.text.trim()));
    const fullSample = sec0.items.find(it => it.text.trim()).text.slice(0, 60);
    await clickTab(page, 'Full Text');
    const fullShown = await waitFor(page, fullSample, 15000);
    const toolbarOk = await page.evaluate(() => !!document.querySelector('[data-ft-toolbar]'));
    const parasOk = await page.evaluate(() => document.querySelectorAll('[data-ft-page] p').length > 0);
    check('2. Full Text opens with paragraphs + an Explain-selection toolbar',
      fullShown && toolbarOk && parasOk);
    await shot(page, '02_full_text');

    // ---- 3. no selection: honest hint, no chip, zero requests ----
    await page.evaluate(() => document.querySelector('[data-ft-toolbar]').click());
    const hintOk = await waitFor(page, 'Select text from the paper to learn about it.', 10000);
    const noChip = await page.evaluate(() => !document.querySelector('[data-ft-chip]'));
    const chromeText = await page.evaluate(() => [
      document.querySelector('[data-ft-toolbar]')?.textContent || '',
      document.querySelector('[data-ft-hint]')?.textContent || '',
    ].join(' '));
    check('3. no selection: honest hint, no chip, no request fired',
      hintOk && noChip && explainCount === 0, `requests=${explainCount}`);
    await shot(page, '03_no_selection_hint');

    // ---- 4. select a passage: single Explain chip, no other modes ----
    const sel = await selectFirstParagraph(page);
    const chipOk = await pollUntil(page, () => !!document.querySelector('[data-ft-chip]'), null, 10000);
    const chipLabel = await page.evaluate(() =>
      (document.querySelector('[data-ft-chip]')?.textContent || '').trim());
    const extraModes = await page.evaluate(() => {
      const banned = ['explain the equation', 'explain the method',
        'explain the algorithm', 'explain the code'];
      return Array.from(document.querySelectorAll('button'))
        .map(b => (b.textContent || '').trim().toLowerCase())
        .filter(t => banned.some(w => t.includes(w)));
    });
    check('4. selection reveals exactly one mode: the Explain chip',
      !!sel && chipOk && chipLabel === 'Explain' && extraModes.length === 0,
      `label="${chipLabel}" extras=${extraModes.length}`);
    await shot(page, '04_explain_chip');

    // ---- 5. Explain opens the panel with a visible loading state ----
    await page.click('[data-ft-chip]');
    const shown = await panelShown(page, 10000);
    const busy = await busyShown(page, 5000);   // request #1 held ~1.6s
    check('5. Explain opens the contextual panel with a visible busy state',
      shown && busy, `panel=${shown} busy=${busy}`);
    await shot(page, '05_busy');

    // ---- 6. controlled failure: actual error + Retry ----
    const errShown = await pollUntil(page, () => {
      const el = document.querySelector('[data-tutor-error]');
      return !!(el && (el.textContent || '').trim().length > 0
        && (el.textContent || '').includes('LiiT backend'));
    }, null, 15000);
    const retryShown = await page.evaluate(() => !!document.querySelector('[data-tutor-retry]'));
    check('6. controlled failure surfaces the real error and a Retry',
      errShown && retryShown, `attempt=${bodies[0] ? 'captured' : 'lost'}`);
    await shot(page, '06_failure_retry');

    // ---- 7. Retry succeeds: explanation + distinct selected text ----
    await page.evaluate(() => document.querySelector('[data-tutor-retry]').click());
    const explained = await explanationShown(page, 180000);   // real local model
    const labels = await page.evaluate(() => ({
      selected: !!document.querySelector('[data-tutor-selected]'),
      explanationLabel: (document.body.textContent || '').toLowerCase().includes('explanation'),
      selectedLabel: (document.body.textContent || '').toLowerCase().includes('selected text'),
      title: (document.querySelector('[data-tutor-paper]')?.textContent || '').trim(),
      prov: (document.querySelector('[data-tutor-prov]')?.textContent || '').trim(),
      explanationText: (document.querySelector('[data-tutor-explanation]')?.textContent || '').trim(),
    }));
    check('7. Retry succeeds: explanation displayed, selected text and explanation clearly distinct',
      explained && labels.selected && labels.explanationLabel && labels.selectedLabel
        && labels.explanationText.length > 0
        && labels.title === richTitle && labels.prov.length > 0,
      `prov="${labels.prov.slice(0, 60)}"`);
    await shot(page, '07_explanation');

    // ---- 8. correct paper association + verbatim selection ----
    const b0 = bodies[0] || {};
    const b1 = bodies[1] || {};
    const assoc = b0.paper_id === RICH && b1.paper_id === RICH
      && b0.text === sel.text && b1.text === sel.text
      && b1.section === sel.section && String(b1.page) === sel.page
      && b1.evidence_id === '';
    check('8. requests bound to this paper; selection preserved verbatim',
      bodies.length >= 2 && assoc,
      `attempts=${bodies.length} text=${b1.text === sel.text} paper=${b1.paper_id}`);
    await shot(page, '08_association');

    // ---- 9. context is bounded: one paragraph, never the paper ----
    const bounded = b1.context === sel.context
      && (b1.text.length + (b1.context || '').length) <= 10000
      && (b1.text.length + (b1.context || '').length) >= b1.text.length
      && !String(b1.text).includes('\u0000');
    const wholePaper = (richSections || [])
      .flatMap(s => (s.items || []).map(it => it.text)).join('').length;
    check('9. context bounded to the selection + one paragraph (never the whole paper)',
      bounded && wholePaper > 10000
        && (b1.text.length + (b1.context || '').length) < wholePaper,
      `sent=${b1.text.length + (b1.context || '').length} paper=${wholePaper}`);

    // ---- 10. close returns to the paper ----
    await page.evaluate(() => document.querySelector('[data-tutor-close]').click());
    const gone = await panelClosed(page, 10000);
    const backOnPaper = await waitFor(page, fullSample, 10000);
    check('10. closing the panel returns to the paper', gone && backOnPaper);
    await shot(page, '10_closed');

    // ---- 11. Learn tab: honest static guidance, nothing generated ----
    await clickTab(page, 'Learn');
    const learnShown = await waitFor(page,
      'Learning happens in context, next to the text', 15000);
    const learnText = await page.evaluate(() =>
      document.querySelector('main')?.textContent || '');
    const noPanelOnLearn = await page.evaluate(() => !document.querySelector('[data-tutor-panel]'));
    check('11. Learn tab shows honest guidance without generating anything',
      learnShown && noPanelOnLearn && explainCount === 2, `requests=${explainCount}`);
    await shot(page, '11_learn_tab');

    // ---- 12. Methods -> Learn: evidence-linked request ----
    const methodEv = evAll.find(e => METHOD_CATS.includes(e.category)
      && chunksApi.some(c => c.chunk_id === e.chunk_id));
    const targetChunk = chunksApi.find(c => c.chunk_id === methodEv.chunk_id);
    await clickTab(page, 'Methods');
    const learnBtn = await pollUntil(page, (id) => !!document.querySelector(
      `.method-item[data-ev-id="${id}"] [data-method-learn]`), methodEv.id, 15000);
    await page.evaluate((id) => document.querySelector(
      `.method-item[data-ev-id="${id}"] [data-method-learn]`).click(), methodEv.id);
    const mPanel = await panelShown(page, 10000);
    const mBusy = await busyShown(page, 8000);
    const mExplained = await explanationShown(page, 180000);
    const b2 = bodies[2] || {};
    const methodsOk = learnBtn && mPanel && mExplained
      && b2.paper_id === RICH
      && b2.evidence_id === methodEv.id
      && b2.text === methodEv.text
      && b2.context === targetChunk.text;
    check('12. Methods → Learn sends the statement + its source chunk + paper context',
      methodsOk && mBusy,
      `ev=${methodEv.id.slice(0, 40)} ctx=${b2.context === targetChunk?.text}`);
    await shot(page, '12_methods_learn');
    await closePanel(page);
    await panelClosed(page, 10000);

    // ---- 13. another paper retains no previous context ----
    await clickText(page, 'button', '← Library');
    await waitFor(page, 'Upload PDF', 15000);
    await clickNav(page, 'Projects');
    await waitFor(page, 'Each project holds its own papers', 15000);
    await clickText(page, 'button', 'knowledge-validation');
    await waitFor(page, p2Title, 15000);
    await clickText(page, 'button', p2Title);
    await clickTab(page, 'Full Text');
    const p2Sample = p2Sections.find(s => (s.items || []).some(it => it.text.trim()))
      .items.find(it => it.text.trim()).text.slice(0, 60);
    await waitFor(page, p2Sample, 15000);
    const noRetained = await page.evaluate(() => !document.querySelector('[data-tutor-panel]'));
    const sel2 = await selectFirstParagraph(page);
    const chip2 = await pollUntil(page, () => !!document.querySelector('[data-ft-chip]'), null, 10000);
    await page.click('[data-ft-chip]');
    const p2Explained = await explanationShown(page, 180000);
    const b3 = bodies[3] || {};
    const p2TitleShown = await pollUntil(page, (t) =>
      (document.querySelector('[data-tutor-paper]')?.textContent || '').trim() === t,
    p2Title, 10000);
    check('13. opening another paper retains no context; new ask bound to that paper',
      noRetained && chip2 && !!sel2 && p2Explained && p2TitleShown
        && b3.paper_id === P2 && b3.text === sel2?.text
        && !bodies.slice(0, 3).some(b => b.paper_id === P2),
      `paper=${b3.paper_id} title=${p2TitleShown}`);
    await shot(page, '13_paper_switch');
    await closePanel(page);
    await panelClosed(page, 10000);

    // ---- 14. Learning view + captured chrome: no overreach language ----
    await clickNav(page, 'Learning');
    const learningShown = await waitFor(page, 'Learning is contextual', 15000);
    const learningText = await page.evaluate(() =>
      document.querySelector('main')?.textContent || '');
    const staticCopy = `${chromeText} ${learnText} ${learningText}`.toLowerCase();
    const hits = BANNED.filter(w => staticCopy.includes(w));
    check('14. no recommendation/overreach language in LiiT\'s own Learning copy',
      learningShown && hits.length === 0,
      hits.length ? `banned: ${hits.join(',')}` : 'clean');
    await shot(page, '14_learning_view');

    // ---- 15. no console errors; only explicit triggers ever fired ----
    check('15. no console or page errors; exactly 4 explicit tutor requests (no auto-runs)',
      pageErrors.length === 0 && explainCount === 4,
      `errors=${pageErrors.length} requests=${explainCount}`);

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`
      + ` — screenshots: /tmp/liit_learning_*.png`);
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
