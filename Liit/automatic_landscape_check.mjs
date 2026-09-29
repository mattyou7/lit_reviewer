// Dedicated integration check for the core flow:
//   ONE SEED PAPER -> AUTOMATIC FIRST-DEGREE DISCOVERY -> MULTI-PAPER LANDSCAPE
// Drives the REAL app in headless Chrome against the REAL backend:
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
// The ONLY user action is uploading one seed PDF; everything else
// (seed metadata resolution, reference discovery, PubMed cited-by,
// semantic similarity search, embedding, edges) happens automatically.
//
// Modes (clearly distinguished runs):
//   LIVE=1           real PubMed/arXiv traffic (the live integration run;
//                    the backend may run with LIIT_HTTP_RECORD_DIR to
//                    capture the fixture set). Check 15 is skipped with
//                    a note — its subject only exists under replay.
//   default (replay) backend must run with LIIT_HTTP_REPLAY_DIR=<fixtures>;
//                    ONE reference-DOI lookup fixture is intentionally
//                    withheld from the set, so check 15 proves channel
//                    errors + the Retry button surface honestly.
//
// Backend must be started on an ISOLATED db (never data/lit_review.db);
// checks 16-17 additionally need that DB's path in LIT_REVIEW_DB:
//   LIVE:  LIT_REVIEW_DB=<db> LIIT_HTTP_RECORD_DIR=<repo>/Liit/fixtures/http \
//            .venv/bin/python -m uvicorn backend.app.main:app --port 8000
//   REPLAY: LIT_REVIEW_DB=<db> LIIT_HTTP_REPLAY_DIR=<repo>/Liit/fixtures/http \
//            .venv/bin/python -m uvicorn backend.app.main:app --port 8000
//
// Checks 16-17 are the REGRESSION for the observed production failure:
// a seed whose automatic build never ran (no run record) showed
// "1 node / 0 edges" forever with no way to start discovery. The check
// reproduces that exact stuck state on the isolated DB (run record +
// discovered papers removed), then asserts the UI reports idle truthfully,
// offers the clearly-labelled "Retry discovery" action, and — on click —
// runs discovery and grows the SAME page past one node (no reload).
//
// Screenshots: /tmp/liit_autodisc_*.png   Exit 1 on any failed check.
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const DB_PATH = process.env.LIT_REVIEW_DB || '';
const LIVE = process.env.LIVE === '1';
const SEED_PDF = fileURLToPath(
  new URL('../data/papers/paper_51af6fc3/original.pdf', import.meta.url));
// The seed of the real paper: "History-dependent Biases in Perceptual
// Decisions Depend on NMDA..." — 18 pages incl. a 4-page reference list.
const SEED_TITLE_FRAGMENT = 'History-dependent';

// Every step run_discovery can truthfully report (no percentages exist).
const KNOWN_STEPS = [
  '', 'resolving seed metadata', 'resolving references',
  'discovering cited-by papers', 'searching PubMed', 'searching arXiv',
  'embedding candidates', 'constructing relationships', 'landscape ready',
];

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

async function count(page, selector) {
  return page.evaluate((s) => document.querySelectorAll(s).length, selector);
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
  // year <select> option "2026" right before "2 nodes" ("20262 nodes").
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+) nodes · (\d+) edges$/);
      if (m) return { nodes: Number(m[1]), edges: Number(m[2]) };
    }
    return null;
  });
}

/** A viewport point on a matching edge whose topmost element IS a hit-line
 *  for that selector. The deterministic layout can place parts of the graph
 *  outside the viewport, and nodes paint over edges — a blind bbox-center
 *  hover can miss entirely (elementFromPoint → null), so sample along each
 *  candidate segment and verify the point would actually receive the event. */
async function edgePoint(page, selector) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    const ts = [0.5, 0.7, 0.3, 0.85, 0.15, 0.6, 0.4, 0.9, 0.1];
    for (const el of els) {
      const ctm = el.getScreenCTM ? el.getScreenCTM() : null;
      if (!ctm) continue;
      const x1 = Number(el.getAttribute('x1'));
      const y1 = Number(el.getAttribute('y1'));
      const x2 = Number(el.getAttribute('x2'));
      const y2 = Number(el.getAttribute('y2'));
      if ([x1, y1, x2, y2].some(Number.isNaN)) continue;
      for (const t of ts) {
        const ux = x1 + (x2 - x1) * t;
        const uy = y1 + (y2 - y1) * t;
        const vx = ctm.a * ux + ctm.c * uy + ctm.e;
        const vy = ctm.b * ux + ctm.d * uy + ctm.f;
        if (!(vx >= 4 && vx < window.innerWidth - 4
          && vy >= 4 && vy < window.innerHeight - 4)) continue;
        const top = document.elementFromPoint(vx, vy);
        if (top && top.matches(s)) return { x: vx, y: vy };
      }
    }
    return null;
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

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_autodisc_${name}.png` });
}

async function api(path, init) {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/** Poll an API-derived predicate until it returns a truthy value. */
async function pollApiUntil(fn, timeout, interval = 500) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() >= deadline) return null;
    await sleep(interval);
  }
}

async function main() {
  console.log(`MODE: ${LIVE ? 'LIVE (real PubMed/arXiv)' : 'REPLAY (fixture set)'}`);
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

  // ---------- the ONE user flow: new project -> upload one seed PDF ----------
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await waitFor(page, 'Projects', 30000);
  await clickText(page, 'button', 'Projects');
  await waitFor(page, 'Each project holds its own papers', 30000);
  const name = `auto-landscape-${Date.now()}`;
  await page.type('input[placeholder="New project name…"]', name);
  await clickText(page, 'button', 'New project');
  await waitFor(page, name, 30000);

  const projects = await api('/api/projects');
  const project = projects.find((p) => p.name === name);
  if (!project) throw new Error('project not found after creation');

  await clickText(page, 'button', 'Library');
  await waitFor(page, 'Upload PDF', 30000);
  const inputHandle = await page.evaluateHandle(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((i) => (i.parentElement?.textContent || '').includes('Upload PDF'))
      || inputs[0];
  });
  const inputEl = inputHandle.asElement();
  if (!inputEl) throw new Error('upload file input not found');
  await inputEl.uploadFile(SEED_PDF);

  // Upload runs ingest synchronously; the automatic build is scheduled on
  // the response (no further user action anywhere in this script).
  const earlyPapers = await pollApiUntil(
    () => api(`/api/projects/${project.id}/papers`).then((ps) => (ps.length >= 1 ? ps : null)),
    60000, 500);
  if (!earlyPapers) throw new Error('seed upload never produced a paper');

  // ---------- 1. exactly one seed, user_import provenance ----------
  const withPdf = earlyPapers.filter((p) => p.source_pdf_path);
  check('1. one seed upload -> exactly one PDF-backed paper (user_import)',
    withPdf.length === 1 && withPdf[0].discovery_source_type === 'user_import'
    && withPdf[0].title.includes(SEED_TITLE_FRAGMENT),
    `pdf_papers=${withPdf.length} type=${withPdf[0] && withPdf[0].discovery_source_type}`);
  const seedId = withPdf[0].id;
  const seedDisc = await api(`/api/papers/${seedId}/discovery`);
  check('1b. seed provenance row user_import recorded',
    seedDisc.discovery.some((d) => d.type === 'user_import'),
    seedDisc.discovery.map((d) => d.type).join(','));

  // ---------- 2. automatic trigger: status leaves idle, no manual step ----------
  let status = await pollApiUntil(async () => {
    const s = await api(`/api/projects/${project.id}/landscape/status`);
    return s.status !== 'idle' ? s : null;
  }, 30000, 250);
  check('2. automatic trigger: build status leaves idle after upload alone',
    status !== null && status.seed_paper_id === seedId,
    status ? `${status.status} seed=${status.seed_paper_id}` : 'still idle');

  // ---------- 4. truthful building banner while the run is in flight ----------
  await clickText(page, 'button', 'Landscape');
  const sawBanner = await waitFor(page, 'Building landscape…', 30000);
  check('4. UI shows "Building landscape… <step>" during the run', sawBanner);

  // ---------- 3. truthful states: known steps, no fake percentages ----------
  const seenSteps = new Set();
  let sawPercentField = false;
  const finalStatus = await pollApiUntil(async () => {
    const s = await api(`/api/projects/${project.id}/landscape/status`);
    const json = JSON.stringify(s);
    if (/percent|progress/i.test(json)) sawPercentField = true;
    if (s.status === 'running') seenSteps.add(s.step);
    else if (s.status !== 'idle') return s;
    return null;
  }, 600000, 500);
  check('3. truthful states: known Phase steps while running, "landscape ready" at end, no percentages',
    finalStatus !== null && finalStatus.status === 'complete'
    && finalStatus.step === 'landscape ready'
    && [...seenSteps].every((t) => KNOWN_STEPS.includes(t))
    && !sawPercentField,
    `steps=[${[...seenSteps].join(' | ')}] final=${finalStatus && finalStatus.status}`);

  if (!finalStatus) throw new Error('build never completed');

  const land = await api(`/api/landscape/${project.id}`);
  console.log('BUILD REPORT: '
    + JSON.stringify({
      channels: finalStatus.channels.map((c) => ({
        channel: c.channel, source: c.source, status: c.status,
        retrieved: c.retrieved, created: c.created, edged: c.edged,
        below_threshold: c.below_threshold, excluded_self: c.excluded_self,
        duplicates: c.duplicates, unresolved: c.unresolved, edges: c.edges,
        errors: c.errors, error: c.error,
      })),
      policy: finalStatus.policy,
      similarities: land.edges.filter((e) => e.relationship === 'semantic_similarity')
        .map((e) => Number(e.similarity.toFixed(4))),
      nodes: land.nodes.map((n) => `${n.discovery_source}: ${n.title.slice(0, 60)}`),
    }, null, 1));

  // UI converges on the backend counts (poll: completion triggers a reload).
  let uiCounts = null;
  for (let i = 0; i < 60; i++) {
    uiCounts = await countsText(page);
    if (uiCounts && uiCounts.nodes === land.nodes.length
      && uiCounts.edges === land.edges.length) break;
    await sleep(500);
  }

  // ---------- 5. multi-paper landscape from ONE seed ----------
  check('5. multi-paper landscape grown from the single seed upload',
    land.nodes.length >= 2 && uiCounts && uiCounts.nodes === land.nodes.length
    && uiCounts.edges === land.edges.length,
    `nodes=${land.nodes.length} edges=${land.edges.length} ui=${JSON.stringify(uiCounts)}`);

  // ---------- 6. dedupe: one node per paper ----------
  const titles = land.nodes.map((n) => n.title);
  const identities = land.nodes.map((n) => n.doi || n.pmid || n.arxiv_id || n.id);
  check('6. no duplicate nodes (unique titles + unique identity)',
    new Set(titles).size === titles.length
    && new Set(identities).size === identities.length);

  // ---------- 7. provenance: typed, seed-linked, never "recommended" ----------
  const seedNode = land.nodes.find((n) => n.id === seedId);
  const discovered = land.nodes.filter((n) => n.id !== seedId);
  const discoveredTypes = new Set(discovered.flatMap((n) => n.discovery.map((d) => d.type)));
  const routeTypes = ['citation_discovery', 'cited_by_discovery', 'semantic_discovery'];
  const discWords = discovered.flatMap((n) => n.discovery.map((d) => `${d.type} ${d.query}`))
    .join(' ').toLowerCase();
  check('7. seed=user_import; discovered carry typed routes linked to the seed; no recommendation wording',
    Boolean(seedNode) && seedNode.discovery.some((d) => d.type === 'user_import')
    && discovered.length > 0
    && [...discoveredTypes].some((t) => routeTypes.includes(t))
    && discovered.every((n) => n.discovery
      .filter((d) => routeTypes.includes(d.type))
      .every((d) => d.source_paper_id === seedId))
    && !discWords.includes('recommend')
    && !discWords.includes('relevant'),
    `types=[${[...discoveredTypes].join(',')}] discovered=${discovered.length}`);

  // ---------- 8. first-degree only: every edge touches the seed ----------
  check('8. first-degree only: every edge touches the seed (no recursive crawl)',
    land.edges.length >= 1
    && land.edges.every((e) => e.source === seedId || e.target === seedId),
    `edges=${land.edges.length}`);

  // ---------- 9. edges: mechanism for cites, stored cosine for similarity ----------
  const cites = land.edges.filter((e) => e.relationship === 'cites');
  const sims = land.edges.filter((e) => e.relationship === 'semantic_similarity');
  check('9a. cites edges carry a mechanism; semantic edges carry a stored cosine in [-1,1]',
    cites.every((e) => Boolean(e.mechanism))
    && sims.every((e) => e.similarity != null && e.similarity >= -1 && e.similarity <= 1)
    && (cites.length + sims.length) === land.edges.length,
    `cites=${cites.length} sims=${sims.length}`);

  if (cites.length > 0) {
    try {
      await page.mouse.move(5, 5);
      await hoverEdge(page, '.graph-edge-hit[data-rel="cites"]');
      await page.waitForSelector('.edge-explanation', { timeout: 10000 }).catch(() => {});
      await sleep(300);
      const exp = await page.evaluate(() =>
        (document.querySelector('.edge-explanation') || {}).textContent || '');
      check('9b. cites explanation reads "A cites B" + "via <mechanism>", never similarity/relevance',
        /cites /.test(exp) && exp.includes('via ')
        && !exp.toLowerCase().includes('similarity')
        && !exp.toLowerCase().includes('relevance'),
        exp.slice(0, 200));
    } catch (e) {
      check('9b. cites explanation reads "A cites B" + "via <mechanism>"', false, String(e));
    }
    await shot(page, 'cites_edge');
    await page.mouse.move(5, 5);
  } else {
    console.log('NOTE  9b. cites explanation skipped — no cites edges in this run');
  }

  // ---------- 10. floor policy: arithmetic honest, stored cosines >= floor ----------
  const sem = finalStatus.channels.filter((c) => c.channel === 'semantic_discovery');
  const floor = finalStatus.policy.similarity_min;
  const bucketsOk = sem.every((c) =>
    c.excluded_self + c.below_threshold + c.edged + c.skipped <= c.retrieved);
  check('10. semantic floor honored: channel buckets bounded by retrieved, stored cosines >= floor',
    sem.length === 2 && bucketsOk
    && sims.every((e) => e.similarity >= floor - 1e-9)
    && sem.every((c) => c.status === 'complete' || c.status === 'skipped'),
    `floor=${floor} ${sem.map((c) => `${c.source}: retrieved=${c.retrieved} edged=${c.edged} below=${c.below_threshold}`).join(' | ')}`);

  // ---------- 11. discovered papers: metadata + embedding only, no LLM ----------
  let metaBad = [];
  for (const n of discovered) {
    const p = await api(`/api/papers/${n.id}`);
    const chunks = await api(`/api/papers/${n.id}/chunks`);
    if (p.extraction_status !== 'pending' || p.source_pdf_path
      || chunks.length > 0 || n.metadata_only !== true
      || n.embedding_status !== 'complete') {
      metaBad.push(`${n.title.slice(0, 40)}: extraction=${p.extraction_status}`
        + ` pdf=${Boolean(p.source_pdf_path)} chunks=${chunks.length}`
        + ` meta_only=${n.metadata_only} emb=${n.embedding_status}`);
    }
  }
  check('11. discovered papers are metadata+embedding only — never extracted, no PDF, no chunks',
    discovered.length > 0 && metaBad.length === 0, metaBad.join('; ') || `n=${discovered.length}`);

  // ---------- 12. all channels + documented policy reported ----------
  const chNames = finalStatus.channels.map((c) => c.channel);
  const semSources = finalStatus.channels
    .filter((c) => c.channel === 'semantic_discovery').map((c) => c.source).sort();
  check('12. status reports every discovery channel + the documented policy',
    ['seed_metadata', 'references', 'cited_by'].every((k) => chNames.includes(k))
    && JSON.stringify(semSources) === JSON.stringify(['arxiv', 'pubmed'])
    && typeof finalStatus.policy.similarity_min === 'number'
    && finalStatus.policy.max_reference_resolutions > 0
    && finalStatus.policy.max_cited_by > 0
    && finalStatus.channels.every((c) =>
      ['complete', 'partial', 'skipped', 'error'].includes(c.status)),
    finalStatus.channels.map((c) => `${c.channel}:${c.source}=${c.status}`).join(', '));

  // ---------- 13. UI: seed badge + provenance via-line to the seed ----------
  await clickNode(page, SEED_TITLE_FRAGMENT);
  const gotSeedBadge = await waitFor(page, 'seed paper', 15000);
  check('13a. seed node shows the seed badge in the detail panel', gotSeedBadge);
  const sample = discovered[0];
  const frag = sample.title.replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/)
    .slice(0, 2).join(' ');
  const clicked = await clickNode(page, frag);
  const gotRoute = await waitFor(page, '_discovery', 15000);
  const panel = await body(page);
  check('13b. discovered node shows its route + via-line naming the seed',
    clicked && gotRoute && panel.includes('via ')
    && panel.includes(SEED_TITLE_FRAGMENT),
    `frag="${frag}"`);
  await shot(page, 'node_panel');

  // ---------- 14. error surfacing matches the API (banner + Retry iff errors) ----------
  const apiErrors = finalStatus.channels
    .flatMap((c) => [c.error, ...c.errors]).filter(Boolean);
  const hasBuildError = Boolean(finalStatus.error);
  const pageText = await body(page);
  const bannerShown = pageText.includes('Discovery finished with channel errors')
    || pageText.includes('Landscape build failed');
  const retryVisible = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .some((b) => (b.textContent || '').includes('Retry discovery')));
  check('14. channel errors and the amber banner + Retry agree with the API',
    (apiErrors.length > 0 || hasBuildError)
      ? (bannerShown && retryVisible)
      : (!bannerShown && !retryVisible),
    `api_errors=${apiErrors.length} banner=${bannerShown} retry=${retryVisible}`);

  // ---------- 15. withheld replay fixture -> honest channel error + Retry works ----------
  if (LIVE) {
    console.log('SKIP  15. withheld-fixture error surfacing — replay mode only'
      + ' (this run is the LIVE PubMed/arXiv integration run)');
  } else {
    const missing = finalStatus.channels
      .flatMap((c) => c.errors).filter((m) => m.includes('replay fixture missing'));
    const bannerNow = (await body(page)).includes('Discovery finished with channel errors')
      || (await body(page)).includes('Landscape build failed');
    let retried = false;
    try {
      await clickText(page, 'button', 'Retry discovery', 0, 15000);
      retried = true;
    } catch (e) {
      console.log(`retry click failed: ${e}`);
    }
    const after = retried
      ? await pollApiUntil(async () => {
        const s = await api(`/api/projects/${project.id}/landscape/status`);
        return (s.status === 'complete' && s.started_at !== finalStatus.started_at) ? s : null;
      }, 600000, 500)
      : null;
    check('15. withheld reference fixture surfaced in its channel + banner, and Retry re-runs to completion',
      missing.length >= 1 && bannerNow && retried && after !== null,
      `missing=${missing.length} banner=${bannerNow} retried=${retried}`
      + ` rerun=${after && after.status}`);
  }

  // ---------- 16. REGRESSION: the observed "1 node / 0 edges" stuck state.
  // A project whose automatic build never ran (no run record — seed entered
  // before the trigger existed or via explicit import) must report idle
  // truthfully, converge (same page, no reload) to the real seed-only
  // graph, and offer a clearly-labelled recovery action — never a dead end.
  // Reproduced on this ISOLATED DB: run record + discovered papers removed,
  // seed (and its provenance/references) kept.
  if (!DB_PATH) {
    check('16. stuck pre-trigger state reported idle with a labelled action',
      false, 'LIT_REVIEW_DB is not set — point it at the isolated backend DB');
  } else {
    // keep the current selection on a paper that survives the reset
    await clickNode(page, SEED_TITLE_FRAGMENT);
    execSync(`sqlite3 "${DB_PATH}"`
      + ` "DELETE FROM landscape_runs;`
      + ` DELETE FROM paper_similarity;`
      + ` DELETE FROM citation_edges;`
      + ` DELETE FROM paper_discovery WHERE paper_id != '${seedId}';`
      + ` DELETE FROM paper_metadata WHERE paper_id != '${seedId}';`
      + ` DELETE FROM paper_embeddings WHERE paper_id != '${seedId}';`
      + ` DELETE FROM papers WHERE id != '${seedId}';"`);
    const idleNow = await pollApiUntil(async () => {
      const s = await api(`/api/projects/${project.id}/landscape/status`);
      return s.status === 'idle' ? s : null;
    }, 30000, 250);
    check('16a. project with no run record reports status idle (API truth)',
      idleNow !== null, idleNow ? idleNow.status : 'still not idle');
    let stuck = null;
    for (let i = 0; i < 40; i++) {
      stuck = await countsText(page);
      if (stuck && stuck.nodes === 1 && stuck.edges === 0) break;
      await sleep(500);
    }
    const pillVisible = await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-testid="landscape-idle-discovery"] button'))
      .some((b) => (b.textContent || '').includes('Retry discovery')));
    check('16b. SAME page converges to 1 node / 0 edges (no reload) AND '
      + 'offers the labelled "Retry discovery" action',
      Boolean(stuck) && stuck.nodes === 1 && stuck.edges === 0 && pillVisible,
      `ui=${JSON.stringify(stuck)} pill=${pillVisible}`);
    await shot(page, 'idle_stuck');
  }

  // ---------- 17. the labelled action recovers: discovery actually runs and
  // the SAME page grows past one node — no navigation, no manual reload,
  // no second upload.
  let recovered = null;
  let rebuilt = null;
  if (DB_PATH) {
    try {
      await clickText(page,
        '[data-testid="landscape-idle-discovery"] button', 'Retry discovery');
    } catch (e) {
      console.log(`idle-state retry click failed: ${e}`);
    }
    const leftIdle = await pollApiUntil(async () => {
      const s = await api(`/api/projects/${project.id}/landscape/status`);
      return s.status !== 'idle' ? s : null;
    }, 30000, 250);
    recovered = leftIdle
      ? await pollApiUntil(async () => {
        const s = await api(`/api/projects/${project.id}/landscape/status`);
        return s.status === 'complete' ? s : null;
      }, 600000, 500)
      : null;
    for (let i = 0; i < 60; i++) {
      rebuilt = await countsText(page);
      if (rebuilt && rebuilt.nodes >= 2) break;
      await sleep(500);
    }
    check('17. labelled Retry from the stuck state runs discovery and the '
      + 'graph refreshes in place to >1 node (no reload, no re-upload)',
      Boolean(recovered) && recovered.status === 'complete'
      && Boolean(rebuilt) && rebuilt.nodes >= 2,
      `status=${recovered && recovered.status} ui=${JSON.stringify(rebuilt)}`);
    await shot(page, 'idle_recovered');
  } else {
    check('17. labelled Retry from the stuck state runs discovery and the '
      + 'graph refreshes in place to >1 node (no reload, no re-upload)',
      false, 'LIT_REVIEW_DB is not set');
  }

  await shot(page, 'final');

  if (pageErrors.length) {
    console.log(`PAGE ERRORS (${pageErrors.length}):`);
    pageErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  }
  console.log(`\nUPLOADED_DIR=data/papers (seed paper id: ${seedId})`);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
