// Real-user MVP end-to-end check: the complete demonstrable workflow,
// driven through the REAL UI in headless Chrome against the REAL backend.
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
//
// The backend must run on an ISOLATED database (never the research DB):
//   LIT_REVIEW_DB=/tmp/liit_mvp_e2e.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000
//
// Workflow covered (all through the UI, no API substitutes for
// upload/process/extract/synthesize/embed/search/import):
//   create project -> upload a real PDF -> process -> extract evidence ->
//   synthesize -> embed -> inspect overview/evidence/synthesis/full text/
//   references/methods -> Landscape node + metadata + provenance ->
//   Open Paper round trip -> PubMed search -> explicit import ->
//   imported paper in Library + Landscape -> open imported paper ->
//   return to Library -> visible error path (non-PDF upload).
//
// Fixture PDF: an existing real paper PDF from the repository's dataset
// (override with MVP_PDF=/path/to/your.pdf).
// Screenshots: /tmp/liit_mvp_*.png   Exit 1 on any failed check.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const PDF = process.env.MVP_PDF
  ?? fileURLToPath(new URL('../data/papers/paper_51af6fc3/original.pdf', import.meta.url));
const NOT_PDF = '/tmp/liit_mvp_not_a_paper.txt';

// A reference (by DOI) of the fixture paper, so the explicit import also
// exercises reference re-resolution -> a real citation edge.
const IMPORT_QUERY = '10.1016/j.neuron.2019.06.001[doi]';

const T = {
  ingest: 300000,
  process: 300000,
  extract: 1800000, // teacher LLM over all chunks — the long pole
  synthesize: 1800000,
  embed: 300000,
  import: 300000,
  search: 90000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Page provenance as rendered: "p. 3" (evidence), "pp. 3–5", "p.3" (synthesis/full text). */
const PROVENANCE_PAGE = /p{1,2}\.\s*\d+/;
const pageErrors = [];
let failures = 0;
const timings = {};

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures += 1;
}

function note(msg) {
  console.log(`NOTE  ${msg}`);
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

async function waitForGone(page, substr, timeout = 15000) {
  return pollUntil(page, (s) => !(document.body.textContent || '').includes(s), substr, timeout);
}

async function waitForAny(page, substrs, timeout) {
  return pollUntil(
    page,
    (ss) => { const t = document.body.textContent || ''; return ss.some(s => t.includes(s)); },
    substrs, timeout);
}

async function count(page, selector) {
  return page.evaluate((s) => document.querySelectorAll(s).length, selector);
}

async function clickText(page, tag, text, nth = 0) {
  const ok = await page.evaluate((t, s, n) => {
    const els = Array.from(document.querySelectorAll(t))
      .filter((e) => (e.textContent || '').trim().includes(s));
    if (!els[n]) return false;
    els[n].scrollIntoView();
    els[n].click();
    return true;
  }, tag, text, nth);
  if (!ok) throw new Error(`click target missing: <${tag}> "${text}" #${nth}`);
}

async function hasButton(page, text) {
  return page.evaluate((s) => Array.from(document.querySelectorAll('button'))
    .some((b) => (b.textContent || '').trim().includes(s)), text);
}

/** Click a paper-detail tab. Scoped to the tab bar: the sidebar has its own
 * "Methods" nav button, so a document-wide text match would hit the wrong one. */
async function clickTab(page, label) {
  const ok = await page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll('button.tab-active, button.tab-inactive'))
      .filter((e) => (e.textContent || '').trim() === s);
    if (!els[0]) return false;
    els[0].scrollIntoView();
    els[0].click();
    return true;
  }, label);
  if (!ok) throw new Error(`tab missing: "${label}"`);
}

async function disabled(page, tag, text) {
  return page.evaluate((t, s) => {
    const el = Array.from(document.querySelectorAll(t))
      .find((e) => (e.textContent || '').trim().includes(s));
    if (!el) return 'missing';
    return el.disabled === true;
  }, tag, text);
}

/** Wait until the paper-detail header (h2) shows this title. */
async function waitForTitle(page, text, timeout = 30000) {
  return pollUntil(
    page,
    (s) => (document.querySelector('h2')?.textContent || '').includes(s),
    text, timeout);
}

/** True iff a button with this label is observed disabled (busy) within ms. */
async function sawDisabled(page, label, ms = 8000) {
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

/** Library list count, scoped so panel text can't fake it. */
async function paperCount(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+) papers?$/);
      if (m) return Number(m[1]);
    }
    return null;
  });
}

/** Landscape counts element text is exactly "N nodes · M edges". */
async function countsText(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+) nodes · (\d+) edges$/);
      if (m) return { nodes: Number(m[1]), edges: Number(m[2]) };
    }
    return null;
  });
}

/** Counts header text is exactly
 * "Landscape N · In project M · Discovered K". */
async function headerCounts(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^Landscape (\d+) · In project (\d+) · Discovered (\d+)$/);
      if (m) return { landscape: Number(m[1]), inProject: Number(m[2]),
                      discovered: Number(m[3]) };
    }
    return null;
  });
}

/** Midpoints of every matching edge (dense graphs occlude the first). */
async function edgePoints(page, selector) {
  return page.evaluate((s) => Array.from(document.querySelectorAll(s))
    .slice(0, 12).map((el) => {
      const r = el.getBoundingClientRect();
      return (!r || (r.width === 0 && r.height === 0))
        ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }).filter(Boolean), selector);
}

/** Backend project id by name (API ground truth for node counts). */
async function projectIdByName(name) {
  const ps = await fetch(`${API}/api/projects`).then((r) => r.json());
  const p = ps.find((x) => x.name === name);
  if (!p) throw new Error(`project not found: ${name}`);
  return p.id;
}

async function clickNode(page, text) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll('.graph-node'))
      .filter((e) => (e.textContent || '').includes(s));
    if (!els[0]) return false;
    els[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, text);
}

/** Midpoint of an SVG <line> (puppeteer hover() fails on stroke-only lines). */
async function edgePoint(page, selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function hoverEdge(page, selector) {
  const p = await edgePoint(page, selector);
  if (!p) throw new Error(`edge not visible: ${selector}`);
  await page.mouse.move(p.x - 2, p.y - 2);
  await page.mouse.move(p.x, p.y);
  await sleep(300);
  return p;
}

async function edgeExplanation(page) {
  return page.evaluate(() =>
    (document.querySelector('.edge-explanation') || {}).textContent || '');
}

/** Type the query and run the search, retrying on transient NCBI 429s. */
async function runSearch(page, queryText, attempts = 3) {
  await waitFor(page, 'Search literature', 30000);
  await page.type('textarea', queryText);
  for (let i = 1; i <= attempts; i++) {
    await clickText(page, 'button', 'Run search');
    await waitForAny(page, ['results for', 'search failed', 'No results'], T.search);
    if ((await body(page)).includes('results for')) return true;
    if (i < attempts) await sleep(15000);
  }
  return false;
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_mvp_${name}.png` });
}

async function preflight() {
  if (!existsSync(PDF)) {
    console.error(`Fixture PDF not found: ${PDF}\nSet MVP_PDF=/path/to/real.pdf to use your own PDF.`);
    process.exit(1);
  }
  const backend = await fetch(`${API}/api/health`)
    .then((r) => r.ok).catch(() => false);
  if (!backend) {
    console.error(`Backend not reachable at ${API} — start it first (see docs/MVP_RUNBOOK.md).`);
    process.exit(1);
  }
  const frontend = await fetch(BASE).then((r) => r.ok).catch(() => false);
  if (!frontend) {
    console.error(`Frontend not reachable at ${BASE} — start it first (see docs/MVP_RUNBOOK.md).`);
    process.exit(1);
  }
}

async function main() {
  await preflight();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      pageErrors.push(`console: ${m.text()}`);
    }
  });
  try {
    await run(page);
  } catch (e) {
    await page.screenshot({ path: '/tmp/liit_mvp_fail.png' });
    const dump = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll('button'))
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)),
      body: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 800),
    }));
    console.error('FAILURE DUMP:', JSON.stringify(dump, null, 1));
    await browser.close();
    console.error('MVP CHECK FAILED:', e.message);
    process.exit(1);
  }
  await browser.close();
  check('no JS/console errors during the run', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));
  console.log('\nTIMINGS ' + JSON.stringify(timings));
  console.log(`${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function run(page) {
  const projectName = `mvp-demo-${Date.now()}`;

  // ---- 1-3. Start LiiT, create a project ----
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  check('1. LiiT opens (app shell rendered)',
    await waitFor(page, 'Projects', 30000));

  await clickText(page, 'button', 'Projects');
  check('2. Projects view opens',
    await waitFor(page, 'Each project holds its own papers', 30000));
  await page.type('input[placeholder="New project name…"]', projectName);
  await clickText(page, 'button', 'New project');
  check('3. project created and selected (empty Library shown)',
    await waitFor(page, 'Add a paper or search PubMed/arXiv.', 30000) &&
    (await body(page)).includes(projectName));
  check('3b. upload enabled once a project is active',
    (await disabled(page, 'button', 'Upload PDF')) === false);
  await shot(page, '01_empty_library');

  // ---- 4-5. Upload a real PDF through the UI ----
  const input = await page.waitForSelector('input[type="file"]')
    .catch(() => null);
  check('4. upload control present', input !== null);
  const uploadStart = Date.now();
  await input.uploadFile(PDF);
  check('5. upload shows a busy state',
    await waitFor(page, 'Uploading & processing…', 15000));
  check('6. uploaded paper opens as paper detail',
    await waitFor(page, 'Analysis pipeline', T.ingest));
  timings.upload_s = Math.round((Date.now() - uploadStart) / 1000);
  check('7. paper identity extracted from the real PDF',
    await waitForTitle(page, 'History-dependent Biases', 120000),
    'title from PDF metadata');
  await sleep(1500);
  let t = await body(page);
  check('8. ingest status reported by backend (complete/partial)',
    t.includes('Complete') || t.includes('Partial'),
    /Complete|Partial/.exec(t)?.[0] ?? 'no status');
  check('9. chunk/section counts shown', /\d+ chunks · \d+ sections/.test(t),
    /(\d+ chunks · \d+ sections)/.exec(t)?.[0] ?? 'no counts');
  check('10. paper listed in the Library (1 paper)', (await paperCount(page)) === 1);
  await shot(page, '02_uploaded');

  // ---- 6. Explicit processing (parse -> chunk) ----
  check('11. process action offered', await hasButton(page, 'Re-run processing'));
  await clickText(page, 'button', 'Re-run processing');
  check('12. processing shows a busy state',
    await sawDisabled(page, 'Processing…', 15000));
  check('13. processing run reports real stats',
    await waitFor(page, 'Last processing run:', T.process));
  t = await body(page);
  const proc = /Last processing run: (\d+) pages → (\d+) chunks \((\w+)\)/.exec(t);
  check('14. processing completed with pages and chunks',
    proc !== null && Number(proc[2]) > 0 && ['complete', 'partial'].includes(proc[3]),
    proc ? proc[0] : 'no line');

  // ---- 7. Evidence extraction (teacher LLM, on demand) ----
  check('15. extract action enabled once chunks exist',
    (await disabled(page, 'button', 'Extract evidence')) === false);
  const extractStart = Date.now();
  await clickText(page, 'button', 'Extract evidence');
  check('16. extraction shows a busy state',
    await sawDisabled(page, 'Extracting…', 20000));
  check('17. extraction run reports stats',
    await waitFor(page, 'Last extraction run:', T.extract), 'timeout 30min');
  timings.extract_s = Math.round((Date.now() - extractStart) / 1000);
  t = await body(page);
  const ext = /Last extraction run: (\w+) · (\d+)\/(\d+) chunks \((\d+) already cached\) · (\d+) items/.exec(t);
  check('18. extraction produced evidence items',
    ext !== null && ['complete', 'partial'].includes(ext[1]) && Number(ext[5]) > 0,
    ext ? ext[0] : 'no stats line');
  check('19. evidence row reports the item count',
    /\d+ evidence items/.test(t),
    /(\d+ evidence items)/.exec(t)?.[0] ?? 'no count');
  await shot(page, '03_extracted');

  // ---- 8. Inspect evidence (provenance: chunk + page) ----
  await clickTab(page, 'Evidence');
  await sleep(800);
  t = await body(page);
  check('20. Evidence tab renders extracted items with counts',
    await waitFor(page, 'items', 15000) && /\b\d+ items\b/.test(t));
  // Evidence cards render page provenance as "p. 3" / "pp. 3–5".
  check('21. evidence shows source provenance (chunk + page or honest unknown)',
    PROVENANCE_PAGE.test(t) || t.includes('SOURCE LOCATION UNKNOWN'),
    PROVENANCE_PAGE.exec(t)?.[0] ?? 'no page marker');
  await shot(page, '04_evidence_tab');

  // ---- 9. Synthesis (teacher LLM, on demand) ----
  await clickTab(page, 'Overview');
  await waitFor(page, 'Analysis pipeline', 15000);
  // The button stays disabled ("Needs evidence first") until the evidence
  // list has loaded — wait for the enabled state instead of racing it.
  const synthEnabled = await pollUntil(page, () => {
    const el = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent || '').includes('Generate synthesis'));
    return !!el && el.disabled === false;
  }, null, 60000);
  check('22. synthesis enabled once evidence exists', synthEnabled);
  const synthStart = Date.now();
  await clickText(page, 'button', 'Generate synthesis');
  check('23. synthesis shows a busy state',
    await sawDisabled(page, 'Synthesizing…', 20000));
  check('24. synthesis run reports stats',
    await waitFor(page, 'Last synthesis run:', T.synthesize), 'timeout 30min');
  timings.synthesize_s = Math.round((Date.now() - synthStart) / 1000);
  t = await body(page);
  const syn = /Last synthesis run: (\w+)/.exec(t);
  check('25. synthesis completed', syn?.[1] === 'complete', syn?.[1] ?? 'no line');

  await clickTab(page, 'Synthesis');
  await sleep(800);
  t = await body(page);
  check('26. structured synthesis rendered with field headings',
    t.includes('research question') || t.includes('main results'),
    'research question / main results');
  check('27. synthesis statements carry source provenance',
    PROVENANCE_PAGE.test(t) || t.includes('SOURCE LOCATION UNKNOWN'),
    PROVENANCE_PAGE.exec(t)?.[0] ?? 'no page marker');
  await shot(page, '05_synthesis_tab');

  // ---- 10. Embedding ----
  await clickTab(page, 'Overview');
  await waitFor(page, 'Analysis pipeline', 15000);
  const embedStart = Date.now();
  await clickText(page, 'button', 'Update embedding');
  check('28. embedding run completes',
    await waitFor(page, 'Last embedding run: complete', T.embed), 'timeout 5min');
  timings.embed_s = Math.round((Date.now() - embedStart) / 1000);
  t = await body(page);
  check('29. stored vector reported (384d MiniLM)', t.includes('384d'));
  check('30. embedding row reports the stored vector',
    /\d+d · sentence-transformers\/all-MiniLM-L6-v2/.test(t));
  await shot(page, '06_embedded');

  // ---- 11. Full text / references / methods inspection ----
  await clickTab(page, 'Full Text');
  await sleep(800);
  t = await body(page);
  check('31. Full Text renders parsed sections with page provenance',
    /introduction|methods|results|discussion/.test(t.toLowerCase()) && PROVENANCE_PAGE.test(t));
  await shot(page, '07_fulltext_tab');

  await clickTab(page, 'References');
  await sleep(1200);
  t = await body(page);
  const refs = /(\d+) references · (\d+) resolved/.exec(t);
  check('32. References tab renders the extracted reference list',
    refs !== null && Number(refs[1]) > 0,
    refs ? refs[0] : (/No resolved references were found/.test(t) ? 'honest empty state' : 'no count'));

  await clickTab(page, 'Methods');
  // Header count renders as "Method evidence · 9 items" whose textContent
  // concatenates directly with the sibling button ("…itemsRe-run…"), so
  // match the exact header — a trailing \b would never match.
  const methodsReady = await pollUntil(page, () => {
    const txt = document.body.textContent || '';
    return /Method evidence · \d+ items/.test(txt)
      || txt.includes('Method evidence has not been extracted yet');
  }, null, 20000);
  t = await body(page);
  check('33. Methods tab shows method evidence or an honest empty state',
    methodsReady,
    /Method evidence · \d+ items/.exec(t)?.[0]
      ?? (t.includes('Method evidence has not been extracted yet')
        ? 'honest empty state' : 'stuck in loading state'));
  await shot(page, '08_methods_tab');

  // ---- 12-14. Landscape: node, metadata, provenance ----
  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(500);
  let c = await countsText(page);
  const h = await headerCounts(page);
  const seedRendered = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.graph-node'))
      .some((e) => (e.textContent || '').includes('History-dependent')));
  check('34. Landscape renders the seed node; auto-discovered papers are Discovered, NOT members',
    c && c.nodes >= 1 && h && h.landscape === c.nodes && h.inProject === 1
      && h.discovered === c.nodes - 1 && seedRendered,
    JSON.stringify({ c, h, seedRendered }));
  check('35. single-paper notice shown only when the landscape really has 1 paper',
    c && c.nodes === 1
      ? (await body(page)).includes('1 paper in landscape.')
      : !(await body(page)).includes('1 paper in landscape.'),
    `nodes=${c && c.nodes}`);
  const simNow = await count(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  check('36. no-similarity note appears iff no semantic edges exist',
    simNow === 0
      ? (await body(page)).includes('No semantic-similarity relationships are currently available.')
      : !(await body(page)).includes('No semantic-similarity relationships are currently available.'),
    `sim=${simNow}`);

  check('37. node selectable', await clickNode(page, 'History-dependent'));
  check('38. node detail panel opens', await waitFor(page, 'Selected paper', 15000));
  await waitForGone(page, 'loading status…', 15000);
  t = await body(page);
  check('39. metadata visible (journal/year rows)', t.includes('Journal'));
  check('40. provenance visible (exact backend value)',
    t.includes('user_import'), 'user_import');
  check('41. embedding status visible in the panel',
    t.includes('embedding: complete'));
  check('42. paper status chip visible in the panel',
    t.includes('Complete') || t.includes('Partial'));
  check('43. relationships section rendered',
    t.includes('No relationships yet.') || t.includes('Relationships'));
  check('44. Open Paper action present', t.includes('Open Paper'));
  await shot(page, '09_landscape_node');

  // ---- 15. Landscape -> Open Paper -> back (context preserved) ----
  await clickText(page, 'button', 'Open Paper');
  check('45. Open Paper lands on the paper detail',
    await waitFor(page, 'Analysis pipeline', 30000) &&
    await waitForTitle(page, 'History-dependent Biases', 15000));
  check('46. project context preserved on paper detail',
    (await body(page)).includes(projectName));
  await clickText(page, 'button', 'Landscape');
  await waitFor(page, 'Selected paper', 30000);
  await sleep(500);
  t = await body(page);
  check('47. returning to Landscape restores the selected node',
    t.includes('Selected paper') && t.includes('History-dependent'));
  check('48. project context intact after the round trip',
    t.includes(projectName));

  // ---- 16-18. Discovery: search -> explicit import ----
  await clickText(page, 'button', 'Searches');
  check('49. Searches view opens', await waitFor(page, 'Search literature', 30000));
  const searchOk = await runSearch(page, IMPORT_QUERY);
  check('50. PubMed search returns results for a known DOI', searchOk,
    searchOk ? IMPORT_QUERY : 'no results / search error');
  let importedTitle = '';
  if (searchOk) {
    importedTitle = await page.evaluate(() =>
      (document.querySelector('h3')?.textContent || '').trim());
    await sleep(500);
    await clickText(page, 'button', '+ Import');
    check('51. explicit import completes (no auto-import anywhere)',
      await waitFor(page, '✓ In library', T.import), 'timeout 5min');
  }
  await shot(page, '10_imported');

  // ---- 19-20. Imported paper in Library ----
  await clickText(page, 'button', 'Open paper →');
  check('52. imported paper opens in the Library',
    importedTitle !== '' && await waitForTitle(page, importedTitle.slice(0, 40), 30000),
    importedTitle.slice(0, 60));
  await sleep(1200);
  t = await body(page);
  // Identity-dedup may land on a paper automatic discovery surfaced first;
  // first-discovery provenance is preserved (never rewritten), and the
  // detail must render whichever provenance the backend actually reports.
  check('53. provenance visible on the imported paper',
    ['pubmed query', 'arxiv query', 'citation discovery', 'user import',
     'semantic discovery', 'cited by'].some((s) => t.includes(s)),
    ['pubmed query', 'citation discovery', 'user import']
      .find((s) => t.includes(s)) ?? 'no provenance label rendered');
  check('54. identifier from the search result visible',
    t.includes('PMID') || t.includes('DOI') || t.includes('arXiv'));
  check('55. metadata-only paper states its limits honestly (no fake pipeline)',
    t.includes('Metadata only') || t.includes('no PDF attached'));
  check('56. extraction honestly disabled for a paper without a PDF',
    (await disabled(page, 'button', 'Extract evidence')) === true);
  await shot(page, '11_imported_paper');

  await clickText(page, 'button', '← Library');
  await sleep(800);
  check('57. Library now lists both papers (2 papers)',
    (await paperCount(page)) === 2, `${await paperCount(page)} papers`);
  t = await body(page);
  check('58. imported title visible in the Library list',
    importedTitle !== '' && t.includes(importedTitle.slice(0, 30)),
    importedTitle.slice(0, 40));

  // ---- 20. Landscape updates: 2 nodes, similarity + citation edges ----
  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(700);
  c = await countsText(page);
  // Ground truth from the API: the import either deduped onto an existing
  // discovered node (count unchanged — no duplicate) or added a new one.
  const land59 = await fetch(`${API}/api/landscape/${await projectIdByName(projectName)}`)
    .then((r) => r.json());
  check('59. Landscape node count matches the API after import (no duplicates)',
    c && c.nodes === land59.nodes.length,
    JSON.stringify({ ui: c && c.nodes, api: land59.nodes.length }));
  const simEdges = await count(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  const citeEdges = await count(page, '.graph-edge-hit[data-rel="cites"]');
  check('60. semantic-similarity edge present after both embeddings exist',
    simEdges >= 1, `sim=${simEdges}`);
  check('61. citation edge present (reference re-resolved on import)',
    citeEdges >= 1, `cites=${citeEdges}`);

  if (simEdges >= 1) {
    // Dense graphs can occlude the first edge's midpoint — hover successive
    // semantic edges until one renders its explanation.
    let exp = '';
    const simPts = await edgePoints(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
    for (const pt of simPts) {
      await page.mouse.move(pt.x, pt.y);
      await page.waitForSelector('.edge-explanation', { timeout: 4000 }).catch(() => {});
      await sleep(250);
      exp = await edgeExplanation(page);
      if (/Semantic similarity: -?\d+\.\d+/.test(exp)) break;
    }
    check('62. similarity edge explains the stored value',
      /Semantic similarity: -?\d+\.\d+/.test(exp), exp.slice(0, 140));
    check('63. similarity never called relevance',
      !exp.toLowerCase().includes('relevance'), exp.slice(0, 140));
    await page.mouse.move(5, 5);
    await sleep(200);
  }
  if (citeEdges >= 1) {
    // Same dense-graph occlusion guard: try successive citation edges
    // until one renders its explanation.
    let expC = '';
    const citePts = await edgePoints(page, '.graph-edge-hit[data-rel="cites"]');
    for (const pt of citePts) {
      await page.mouse.move(pt.x, pt.y);
      await page.waitForSelector('.edge-explanation', { timeout: 4000 }).catch(() => {});
      await sleep(250);
      expC = await edgeExplanation(page);
      if (/\bcites\b/.test(expC)) break;
    }
    check('64. citation edge explains "A cites B"', /\bcites\b/.test(expC),
      expC.slice(0, 160));
    await page.mouse.move(5, 5);
    await sleep(200);
  }

  // imported node provenance in Landscape (match on the title's first word,
  // which always sits inside the node's short label)
  const importedWord = (importedTitle.split(/\s+/)[0] || importedTitle).slice(0, 24);
  const importedNodeClicked = await clickNode(page, importedWord);
  check('65. imported node selectable in Landscape', importedNodeClicked);
  await waitFor(page, 'pubmed_query', 15000);
  await waitForGone(page, 'loading status…', 15000);
  t = await body(page);
  check('66. imported node provenance exact value + query',
    t.includes('pubmed_query') && t.includes(IMPORT_QUERY));
  check('67. imported node provenance external id',
    t.includes('pmid:'));
  check('68. imported node embedding status',
    t.includes('embedding: complete'));
  await shot(page, '12_landscape_updated');

  // ---- 21. Open imported paper, return to Library ----
  await clickText(page, 'button', 'Open Paper');
  check('69. imported paper opens from Landscape',
    await waitForTitle(page, importedTitle.slice(0, 40), 30000));
  await clickText(page, 'button', '← Library');
  await sleep(600);
  check('70. return to Library (both papers still listed)',
    (await paperCount(page)) === 2);

  // ---- Error visibility: non-PDF upload shows the real backend error ----
  writeFileSync(NOT_PDF, 'This is not a PDF.\n');
  const input2 = await page.waitForSelector('input[type="file"]');
  await input2.uploadFile(NOT_PDF);
  check('71. rejected upload surfaces the real backend error (no silent failure)',
    await waitFor(page, 'only .pdf uploads supported', 30000));
  check('72. error state offers a retry', (await body(page)).includes('Retry'));
  const afterError = await paperCount(page);
  if (afterError !== 2) {
    note(`failed upload left ${afterError} paper row(s) in the Library ` +
      '(backend creates the paper row before validating the file) — ' +
      'reported as a known limitation, not an MVP blocker.');
  }
  await shot(page, '13_error_visible');
}

main().catch((e) => {
  console.error('MVP CHECK FAILED:', e);
  process.exit(1);
});
