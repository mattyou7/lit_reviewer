// Manual integration check for the landscape interaction + provenance slice.
// Drives the REAL app in headless Chrome against the REAL backend:
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
// (backend runs on an isolated copy of the dev DB, LIT_REVIEW_DB).
// Covers: node detail/provenance panel, Open Paper round trip with
// selection preserved, edge hover/click explanations for both relationship
// types, client-side filters (edge type, similarity threshold, year, search),
// PubMed import -> project + provenance + citation edge + similarity edges,
// and the empty / single-paper / no-similarity / API-failure states.
// Screenshots: /tmp/liit_landscape_*.png   Exit 1 on any failed check.
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

async function waitForGone(page, substr, timeout = 15000) {
  return pollUntil(page, (s) => !(document.body.textContent || '').includes(s), substr, timeout);
}

async function count(page, selector) {
  return page.evaluate((s) => document.querySelectorAll(s).length, selector);
}

/** Click the nth matching target, waiting for it to render first (rows and
 * panels render on independent fetches — a one-shot click can race). */
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

async function clickNode(page, text) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll('.graph-node'))
      .filter((e) => (e.textContent || '').includes(s));
    if (!els[0]) return false;
    els[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, text);
}

async function countsText(page) {
  // Scope to the exact counts element: body.textContent concatenates the
  // year <select> option "2026" right before "2 nodes" ("20262 nodes"),
  // which corrupts a body-wide regex.
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+) nodes · (\d+) edges$/);
      if (m) return { nodes: Number(m[1]), edges: Number(m[2]) };
    }
    return null;
  });
}

/** Clear a React-controlled text input reliably (native setter + input event). */
async function clearInput(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, selector);
}

/** Bbox center of an SVG <line> = midpoint of the segment (works where
 * puppeteer's clickablePoint fails: stroke-only lines have no content quads). */
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
  // Wiggle first so a mousemove fires even if the pointer is already there.
  await page.mouse.move(p.x - 2, p.y - 2);
  await page.mouse.move(p.x, p.y);
  await sleep(300);
  return p;
}

async function clickEdge(page, selector) {
  const p = await edgePoint(page, selector);
  if (!p) throw new Error(`edge not visible: ${selector}`);
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  return p;
}

async function setSelect(page, nth, value) {
  return page.evaluate((n, v) => {
    const els = document.querySelectorAll('select');
    if (!els[n]) return false;
    const el = els[n];
    el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, nth, value);
}

/** Select by stable testid — control ORDER changed when the workspace
 * gained Sort By / Sort Direction before the year selects. */
async function setSelectBy(page, selector, value) {
  return page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
}

async function setRange(page, nth, value) {
  return page.evaluate((n, v) => {
    const els = document.querySelectorAll('input[type="range"]');
    if (!els[n]) return false;
    const el = els[n];
    // Use the prototype setter: assigning el.value directly goes through
    // React's instance value-tracker and onChange never fires.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, nth, value);
}

async function uncheckLabel(page, text) {
  return page.evaluate((s) => {
    const labels = Array.from(document.querySelectorAll('label'))
      .filter((e) => (e.textContent || '').trim().includes(s));
    if (!labels[0]) return false;
    const input = labels[0].querySelector('input[type="checkbox"]');
    if (!input) return false;
    input.click();
    return true;
  }, text);
}

async function waitForAny(page, substrs, timeout) {
  return pollUntil(
    page,
    (ss) => { const t = document.body.textContent || ''; return ss.some(s => t.includes(s)); },
    substrs, timeout);
}

/** Type the query and run the search, retrying on transient NCBI 429s.
 * Returns true when results rendered (not an error, not "No results"). */
async function runSearch(page, queryText, attempts = 3) {
  await waitFor(page, 'Search literature', 30000);
  await page.type('textarea', queryText);
  for (let i = 1; i <= attempts; i++) {
    await clickText(page, 'button', 'Run search');
    await waitForAny(page, ['results for', 'search failed', 'No results'], 90000);
    if ((await body(page)).includes('results for')) return true;
    if (i < attempts) await sleep(15000); // let NCBI's rate limit cool down
  }
  return false;
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_landscape_${name}.png` });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  let failLandscape = false;
  page.on('request', (req) => {
    // continue()/abort() reject while interception is disabled — swallowed.
    if (failLandscape && req.url().includes('/api/landscape/')) {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      pageErrors.push(msg.text());
    }
  });

  // ---------- Phase A: default project (synthesis-validation, 0 edges) ----------
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await waitFor(page, 'synthesis-validation', 30000);
  check('1. app opens with project context synthesis-validation',
    (await body(page)).includes('synthesis-validation'));

  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(400);
  let c = await countsText(page);
  check('2. Landscape opens and nodes load', c !== null, JSON.stringify(c));
  check('3. default project shows 2 nodes', c && c.nodes === 2, JSON.stringify(c));
  check('4. no-similarity note shown when project has no semantic edges',
    (await body(page)).includes('No semantic-similarity relationships are currently available.'));
  check('5. similarity slider hidden when no semantic edges exist',
    (await count(page, 'input[type="range"]')) === 0);
  await shot(page, 'a_default');

  // node detail + provenance panel
  check('6a. select node -> Selected paper panel', await clickNode(page, 'Quantum Mpemba'));
  check('6b. panel shows title', await waitFor(page, 'Selected paper') &&
    (await body(page)).includes('Quantum Mpemba'));
  const p = await body(page);
  check('6c. journal row present', p.includes('Journal not available') || p.includes('Journal'), 'journal row');
  check('6d. identifier row shows arXiv id', p.includes('arXiv 2609.24993'));
  check('6e. provenance shows exact backend value arxiv_query', p.includes('arxiv_query'));
  check('6f. provenance shows query text', p.includes('transformer attention mechanisms'));
  check('6g. provenance shows external id', p.includes('arxiv:2609.24993v1'));
  check('6h. metadata-only flag visible', p.includes('metadata only'));
  check('6i. embedding status visible', p.includes('embedding: complete'));
  check('6j. relationships section present', p.includes('No relationships yet.') || p.includes('Relationships'));
  check('6k. Open Paper button present', p.includes('Open Paper'));
  await waitForGone(page, 'loading status…', 15000);
  check('6l. paper status chip loads (Pending)', (await body(page)).includes('Pending'));
  await shot(page, 'a_panel');

  // filters: year + search
  await setSelectBy(page, 'select[data-testid="landscape-filter-year-from"]', 2026);
  await sleep(300);
  c = await countsText(page);
  check('11a. year filter from=2026 hides null-year paper', c && c.nodes === 1, JSON.stringify(c));
  await setSelectBy(page, 'select[data-testid="landscape-filter-year-from"]', '');
  await sleep(300);

  await page.type('input[placeholder="Search papers by keyword…"]', 'zzz-no-match');
  await sleep(400);
  check('11b. non-matching search -> explicit no-match state',
    (await body(page)).includes('No papers match the current filters.'));
  await clearInput(page, 'input[placeholder="Search papers by keyword…"]');
  await sleep(300);
  c = await countsText(page);
  check('11c. search cleared -> nodes back', c && c.nodes === 2, JSON.stringify(c));

  // ---------- 5. Landscape -> paper -> landscape ----------
  await clickText(page, 'button', 'Open Paper');
  const onPaperDetail = await waitFor(page, 'Analysis pipeline', 30000);
  check('7a. Open Paper shows paper detail view', onPaperDetail &&
    (await body(page)).includes('Quantum Mpemba'));
  check('7b. project context preserved on paper detail',
    (await body(page)).includes('synthesis-validation'));

  await clickText(page, 'button', 'Landscape');
  await waitFor(page, 'Selected paper', 30000);
  await sleep(600);
  const back = await body(page);
  check('7c. return to Landscape restores previously selected node',
    back.includes('Selected paper') && back.includes('Quantum Mpemba'));
  check('7d. project context intact after round trip', back.includes('synthesis-validation'));
  await shot(page, 'a_roundtrip');

  // ---------- Phase B: knowledge-validation (semantic edge exists) ----------
  await clickText(page, 'button', 'Projects');
  await clickText(page, 'button', 'knowledge-validation');
  // Selecting a project clears selectedPaperId (App.tsx), so Library shows
  // the paper LIST, not paper detail — wait for the Projects page to unmount.
  const switched = await waitForGone(page, 'Each project holds its own papers', 30000);
  check('12. project switch to knowledge-validation leaves Projects view', switched &&
    (await body(page)).includes('knowledge-validation'));
  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(500);
  c = await countsText(page);
  check('12a. knowledge-validation loads 2 nodes / 1 edge',
    c && c.nodes === 2 && c.edges === 1, JSON.stringify(c));
  check('12b. selection cleared when switching project (placeholder shown)',
    (await body(page)).includes('Click a node to see details.'));
  check('12c. similarity slider shown when semantic edges exist',
    (await count(page, 'input[type="range"]')) === 1);

  // 8. semantic edge hover -> explanation (mouse events at line midpoint;
  // puppeteer hover() can't compute a clickable point for stroke-only lines)
  await hoverEdge(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  await page.waitForSelector('.edge-explanation', { timeout: 10000 }).catch(() => {});
  await sleep(300);
  let exp = await page.evaluate(() =>
    (document.querySelector('.edge-explanation') || {}).textContent || '');
  check('9a. semantic edge hover shows explanation',
    exp.includes('Semantic similarity: 0.12'), exp.slice(0, 120));
  check('9b. explanation shows both papers', exp.includes('↔'), exp.slice(0, 160));
  check('9c. similarity value matches stored 0.12081029266119 -> 0.1208',
    exp.includes('0.1208'), exp.slice(0, 160));
  check('9d. never labeled relevance',
    !exp.toLowerCase().includes('relevance'), exp.slice(0, 160));

  // pin: click -> persists after mouse leaves; click again -> dismisses
  await clickEdge(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  await page.mouse.move(5, 5);
  await sleep(400);
  exp = await page.evaluate(() =>
    (document.querySelector('.edge-explanation') || {}).textContent || '');
  check('10a. clicking edge pins the explanation', exp.includes('Pinned'), exp.slice(0, 160));
  await shot(page, 'b_edge_pinned');
  await clickEdge(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  await page.mouse.move(5, 5);
  await sleep(400);
  check('10b. clicking pinned edge again dismisses it',
    (await count(page, '.edge-explanation')) === 0);

  // similarity threshold filter
  await setRange(page, 0, 0.5);
  await sleep(300);
  c = await countsText(page);
  check('11d. similarity threshold 0.5 hides the 0.1208 edge',
    c && c.edges === 0, JSON.stringify(c));
  await setRange(page, 0, -1);
  await sleep(300);
  c = await countsText(page);
  check('11e. threshold reset restores edge', c && c.edges === 1, JSON.stringify(c));

  // relationship-type filter
  await uncheckLabel(page, 'semantic similarity');
  await sleep(300);
  c = await countsText(page);
  check('11f. relationship-type filter hides semantic edges',
    c && c.edges === 0, JSON.stringify(c));
  await uncheckLabel(page, 'semantic similarity');
  await sleep(300);
  c = await countsText(page);
  check('11g. relationship-type filter re-enabled', c && c.edges === 1, JSON.stringify(c));

  // ---------- Phase C: PubMed import -> citation edge + provenance ----------
  await clickText(page, 'button', 'Searches');
  const searchOk = await runSearch(page, '10.1038/s41593-021-00845-1[doi]');
  check('13a. PubMed DOI search returns results', searchOk, searchOk ? '' : 'no results / search error');
  let imported = false;
  if (searchOk) {
    await sleep(500);
    await clickText(page, 'button', '+ Import');
    imported = await waitFor(page, '✓ In library', 180000);
  }
  check('13a2. explicit PubMed import completes', imported);

  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(600);
  c = await countsText(page);
  check('13b. imported paper appears in landscape (3 nodes)',
    c && c.nodes === 3, JSON.stringify(c));
  const citesCount = await count(page, '.graph-edge-hit[data-rel="cites"]');
  const simCount = await count(page, '.graph-edge-hit[data-rel="semantic_similarity"]');
  check('13c. citation edge created by reference re-resolution', citesCount >= 1,
    `cites=${citesCount}`);
  check('13d. similarity edges present after embedding', simCount >= 3,
    `sim=${simCount}`);

  // 8. citation edge explanation
  const hasCites = (await count(page, '.graph-edge-hit[data-rel="cites"]')) > 0;
  exp = '';
  if (hasCites) {
    await hoverEdge(page, '.graph-edge-hit[data-rel="cites"]');
    await page.waitForSelector('.edge-explanation', { timeout: 10000 }).catch(() => {});
    await sleep(300);
    exp = await page.evaluate(() =>
      (document.querySelector('.edge-explanation') || {}).textContent || '');
  }
  check('9e. citation edge explanation is "A cites B"',
    /cites Correlations enhance/.test(exp), exp.slice(0, 200));
  check('9e. citation edge explanation is "A cites B"',
    /cites Correlations enhance/.test(exp), exp.slice(0, 200));
  check('9f. citation edge not called similarity/relevance',
    !exp.toLowerCase().includes('similarity') && !exp.toLowerCase().includes('relevance'),
    exp.slice(0, 200));
  await shot(page, 'c_citation_edge');
  await page.mouse.move(5, 5);

  // imported node provenance panel
  check('14a. select imported node', await clickNode(page, 'Correlations'));
  await waitFor(page, 'pubmed_query', 15000);
  await waitForGone(page, 'loading status…', 15000);
  let np = await body(page);
  check('14b. provenance exact value pubmed_query', np.includes('pubmed_query'));
  check('14c. provenance query text preserved', np.includes('10.1038/s41593-021-00845-1[doi]'));
  check('14d. provenance external id preserved', np.includes('pmid:33986549'));
  check('14e. DOI + PMID identifiers shown',
    np.includes('DOI 10.1038/s41593-021-00845-1') && np.includes('PMID 33986549'));
  check('14f. paper status shown', np.includes('Pending'));
  check('14g. relationship list cites incoming',
    np.includes('← cited by'), 'incoming citation row');
  check('14h. relationship list shows stored similarity values',
    /semantic similarity 0\./.test(np), 'similarity rows');
  check('14i. no relevance/recommendation language in panel',
    !np.toLowerCase().includes('recommended because') &&
    !np.toLowerCase().includes('relevant because'), 'provenance wording');
  await shot(page, 'c_import_panel');

  // ---------- Phase D: empty project, single paper, API failure ----------
  await clickText(page, 'button', 'Projects');
  await waitFor(page, 'Each project holds its own papers', 30000);
  const name = `landscape-check-${Date.now()}`;
  await page.type('input[placeholder="New project name…"]', name);
  await clickText(page, 'button', 'New project');
  await waitFor(page, name, 30000);

  await clickText(page, 'button', 'Landscape');
  const emptyShown = await waitFor(page, 'Add a seed paper to begin exploring the research landscape.', 30000);
  check('12d. empty landscape state (exact string)', emptyShown, 'empty project');
  await shot(page, 'd_empty');

  // import exactly one paper into the fresh project
  await clickText(page, 'button', 'Searches');
  const singleSearchOk = await runSearch(page, 'hippocampal place cells');
  check('13e. single-paper search returns results', singleSearchOk,
    singleSearchOk ? '' : 'no results / search error');
  let singleImported = false;
  if (singleSearchOk) {
    await sleep(500);
    await clickText(page, 'button', '+ Import');
    singleImported = await waitFor(page, '✓ In library', 180000);
  }
  check('13e2. single-paper import completes', singleImported);

  await clickText(page, 'button', 'Landscape');
  await page.waitForSelector('.graph-node', { timeout: 30000 });
  await sleep(600);
  c = await countsText(page);
  check('13f. single-paper landscape: 1 node / 0 edges',
    c && c.nodes === 1 && c.edges === 0, JSON.stringify(c));
  let single = await body(page);
  check('13g. single-paper note shown',
    single.includes('1 paper in landscape.'));
  check('13h. no-similarity note shown for single paper',
    single.includes('No semantic-similarity relationships are currently available.'));
  // select the node to expose provenance
  await page.evaluate(() => {
    const n = document.querySelectorAll('.graph-node')[0];
    if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitFor(page, 'pubmed_query', 15000);
  single = await body(page);
  check('13i. single-paper provenance visible after selection',
    single.includes('pubmed_query') && single.includes('hippocampal place cells'));
  await shot(page, 'd_single');

  // API failure state -> honest error + Retry works.
  // Interception handler is attached up-front and gated by `intercepting`
  // so no request is ever left hanging.
  await clickText(page, 'button', 'Library');
  await sleep(300);
  failLandscape = true;
  await page.setRequestInterception(true);
  await clickText(page, 'button', 'Landscape');
  const errShown = await waitFor(page, 'Landscape failed', 30000);
  check('15a. API failure shows honest error state', errShown);
  check('15b. Retry offered', (await body(page)).includes('Retry'));
  await shot(page, 'd_error');
  failLandscape = false;
  await clickText(page, 'button', 'Retry');
  await page.waitForSelector('.graph-node', { timeout: 30000 }).catch(() => {});
  await sleep(500);
  c = await countsText(page);
  check('15c. Retry recovers and loads the graph', c && c.nodes === 1, JSON.stringify(c));

  check('16. no unexpected JS errors', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
