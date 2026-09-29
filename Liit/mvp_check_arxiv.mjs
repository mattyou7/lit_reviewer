// Complementary MVP check: the arXiv branch of Discovery, through the REAL
// UI in headless Chrome against the REAL backend.
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
//
// The main workflow check (`mvp_check.mjs`) validates search -> explicit
// import with PubMed; this script validates the same UI path with arXiv:
// search -> inspect results -> explicit import -> paper in Library ->
// paper in Landscape with arXiv provenance. No teacher-LLM calls, so it
// is cheap to run; the backend may use the same isolated database (it
// creates its own project if none is selected yet).
//
// Screenshots: /tmp/liit_mvp_arxiv_*.png   Exit 1 on any failed check.
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const QUERY = 'hippocampal place cells';
const IMPORT_TIMEOUT = 300000;

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

async function waitForAny(page, substrs, timeout) {
  return pollUntil(
    page,
    (ss) => { const t = document.body.textContent || ''; return ss.some(s => t.includes(s)); },
    substrs, timeout);
}

async function waitForTitle(page, text, timeout = 30000) {
  return pollUntil(
    page,
    (s) => (document.querySelector('h2')?.textContent || '').includes(s),
    text, timeout);
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

async function clickNode(page, text) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll('.graph-node'))
      .filter((e) => (e.textContent || '').includes(s));
    if (!els[0]) return false;
    els[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, text);
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_mvp_arxiv_${name}.png` });
}

async function runSearch(page, queryText, attempts = 3) {
  await waitFor(page, 'Search literature', 30000);
  await page.type('textarea', queryText);
  for (let i = 1; i <= attempts; i++) {
    await clickText(page, 'button', 'Run search');
    await waitForAny(page, ['results for', 'search failed', 'No results'], 90000);
    if ((await body(page)).includes('results for')) return true;
    if (i < attempts) await sleep(10000);
  }
  return false;
}

async function main() {
  const backend = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  if (!backend) {
    console.error(`Backend not reachable at ${API} — start it first (see docs/MVP_RUNBOOK.md).`);
    process.exit(1);
  }
  const frontend = await fetch(BASE).then((r) => r.ok).catch(() => false);
  if (!frontend) {
    console.error(`Frontend not reachable at ${BASE} — start it first (see docs/MVP_RUNBOOK.md).`);
    process.exit(1);
  }

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
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitFor(page, 'Projects', 30000);
    check('1. app shell rendered', true);

    // Baseline counts (create a project first when the DB has none).
    await clickText(page, 'button', 'Searches');
    if (await waitFor(page, 'No project selected', 8000)) {
      await clickText(page, 'button', 'Projects');
      await waitFor(page, 'Each project holds its own papers', 30000);
      const name = `arxiv-check-${Date.now()}`;
      await page.type('input[placeholder="New project name…"]', name);
      await clickText(page, 'button', 'New project');
      check('2. created a project (none was selected)',
        await waitFor(page, 'Add a paper or search PubMed/arXiv.', 30000));
      await clickText(page, 'button', 'Searches');
      await waitFor(page, 'Search literature', 30000);
    }

    await clickText(page, 'button', 'Library');
    await sleep(800);
    const papersBefore = (await paperCount(page)) ?? 0;

    await clickText(page, 'button', 'Landscape');
    await sleep(1200);
    let c = await countsText(page);
    const emptyBefore = (await body(page)).includes('Add a seed paper to begin exploring the research landscape.');
    const nodesBefore = c ? c.nodes : (emptyBefore ? 0 : null);
    check('3. baseline landscape state read', nodesBefore !== null,
      `nodes=${nodesBefore}`);

    // ---- arXiv search ----
    await clickText(page, 'button', 'Searches');
    await waitFor(page, 'Search literature', 30000);
    await clickText(page, 'button', 'arXiv');
    const searchOk = await runSearch(page, QUERY);
    check('4. arXiv search returns results', searchOk,
      searchOk ? QUERY : 'no results / search error');
    let importedTitle = '';
    if (searchOk) {
      importedTitle = await page.evaluate(() =>
        (document.querySelector('h3')?.textContent || '').trim());
      check('5. results show title/year/source metadata rows',
        (await body(page)).includes('Year not available') ||
        /\b(19|20)\d{2}\b/.test(await body(page)));
      await sleep(500);
      await clickText(page, 'button', '+ Import');
      check('6. explicit arXiv import completes',
        await waitFor(page, '✓ In library', IMPORT_TIMEOUT), 'timeout 5min');
    }
    await shot(page, '01_imported');

    // ---- imported paper in Library ----
    await clickText(page, 'button', 'Open paper →');
    check('7. imported arXiv paper opens in the Library',
      importedTitle !== '' && await waitForTitle(page, importedTitle.slice(0, 40), 30000),
      importedTitle.slice(0, 60));
    await sleep(1200);
    let t = await body(page);
    check('8. provenance visible (discovery_source_type arxiv_query)',
      t.includes('arxiv query'), 'header shows "arxiv query"');
    check('9. metadata-only paper states its limits honestly',
      t.includes('Metadata only') || t.includes('no PDF attached'));
    await shot(page, '02_paper_detail');

    await clickText(page, 'button', '← Library');
    await sleep(800);
    const papersAfter = (await paperCount(page)) ?? 0;
    check('10. Library gained exactly one paper', papersAfter === papersBefore + 1,
      `${papersBefore} -> ${papersAfter}`);

    // ---- Landscape update + provenance ----
    await clickText(page, 'button', 'Landscape');
    await page.waitForSelector('.graph-node', { timeout: 30000 });
    await sleep(700);
    c = await countsText(page);
    check('11. Landscape gained exactly one node',
      c && nodesBefore !== null && c.nodes === nodesBefore + 1,
      `${nodesBefore} -> ${c ? c.nodes : 'null'}`);

    const importedWord = (importedTitle.split(/\s+/)[0] || importedTitle).slice(0, 24);
    check('12. imported node selectable', await clickNode(page, importedWord));
    check('13. node panel opens', await waitFor(page, 'Selected paper', 15000));
    await waitFor(page, 'arxiv_query', 15000);
    await sleep(1500);
    t = await body(page);
    check('14. provenance exact backend value arxiv_query', t.includes('arxiv_query'));
    check('15. provenance query text preserved', t.includes(QUERY));
    check('16. provenance external id preserved', t.includes('arxiv:'));
    check('17. embedding completed at import', t.includes('embedding: complete'));
    check('18. Open Paper action present', t.includes('Open Paper'));
    await shot(page, '03_landscape_node');

    await clickText(page, 'button', 'Open Paper');
    check('19. Open Paper round trip lands on the paper detail',
      await waitForTitle(page, importedTitle.slice(0, 40), 30000));
    await clickText(page, 'button', '← Library');
    await sleep(600);
    check('20. returned to the Library',
      (await paperCount(page)) === papersBefore + 1);
  } catch (e) {
    await page.screenshot({ path: '/tmp/liit_mvp_arxiv_fail.png' });
    const dump = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll('button'))
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)),
      body: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 600),
    }));
    console.error('FAILURE DUMP:', JSON.stringify(dump, null, 1));
    await browser.close();
    console.error('ARXIV CHECK FAILED:', e.message);
    process.exit(1);
  }

  await browser.close();
  check('21. no JS/console errors during the run', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '));
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ARXIV CHECK FAILED:', e);
  process.exit(1);
});
