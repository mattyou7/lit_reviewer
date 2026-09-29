// Integration check for the Landscape RESEARCH-EXPLORATION WORKSPACE:
//   DISCOVERED PAPERS != ADDED TO PROJECT (explicit [Add to Project]).
// Drives the REAL app in headless Chrome against the REAL backend:
//   frontend http://127.0.0.1:8443 (Vite dev) -> backend http://127.0.0.1:8000
// (backend on an ISOLATED db in REPLAY mode, never data/lit_review.db):
//   LIT_REVIEW_DB=/tmp/liit_workspace.db \
//   LIIT_HTTP_REPLAY_DIR=<repo>/Liit/fixtures/http \
//     .venv/bin/python -m uvicorn backend.app.main:app --port 8000
//
// 37 checks (numbered 1..37) + a 19-step real-user acceptance workflow
// (A1..A19) proving DISCOVERED != ADDED TO PROJECT end to end.
// Ground truth always comes from the API (GET /landscape, collection);
// every count/label expectation is derived from data, never hard-coded.
// Screenshots: /tmp/liit_workspace_*.png   Exit 1 on any failed check/step.
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const BASE = 'http://127.0.0.1:8443/';
const API = 'http://127.0.0.1:8000';
const SEED_PDF = fileURLToPath(
  new URL('../data/papers/paper_51af6fc3/original.pdf', import.meta.url));
const CURRENT_YEAR = new Date().getFullYear();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageErrors = [];
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures += 1;
}

function step(n, ok, extra = '') {
  console.log(`${ok ? 'STEP' : 'STEP-FAIL'}  ${n}${extra ? `  [${extra}]` : ''}`);
  if (!ok) failures += 1;
}

async function body(page) {
  return page.evaluate(() => document.body.textContent || '');
}

async function pollUntil(page, fn, arg, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch { /* navigation race — retry */ }
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

async function clickSel(page, selector, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.scrollIntoView();
      el.click();
      return true;
    }, selector);
    if (ok) return;
    if (Date.now() >= deadline) throw new Error(`click target missing: ${selector}`);
    await sleep(250);
  }
}

/** Scoped counts element (body-wide regex would hit <select> options). */
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

/** Library collection count: first element that is exactly "N papers". */
async function paperCount(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const m = (el.textContent || '').trim().match(/^(\d+) papers?$/);
      if (m) return Number(m[1]);
    }
    return null;
  });
}

async function labelText(page, testid) {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    return el ? (el.textContent || '').trim() : null;
  }, testid);
}

/** Count/​text scoped to the Split/graph FULL detail card only — rows in
 * the table carry the SAME testids, so unscoped queries lie. */
async function detailCount(page, testid) {
  return page.evaluate((tid) => document.querySelectorAll(
    `[data-testid="landscape-detail"] [data-testid="${tid}"]`).length, testid);
}

async function detailText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="landscape-detail"]');
    return el ? (el.textContent || '') : '';
  });
}

async function clearInput(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, selector);
}

async function setSelectBy(page, selector, value) {
  return page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
}

/** Toggle a labelled checkbox by its data-testid + label substring. */
async function toggleLabel(page, testid, labelSubstr) {
  return page.evaluate((tid, sub) => {
    const labels = Array.from(document.querySelectorAll(`label[data-testid="${tid}"]`))
      .filter((l) => (l.textContent || '').includes(sub));
    if (!labels[0]) return false;
    const input = labels[0].querySelector('input[type="checkbox"]');
    if (!input) return false;
    input.click();
    return true;
  }, testid, labelSubstr);
}

async function rowIds(page) {
  return page.evaluate(() => Array.from(
    document.querySelectorAll('[data-testid="landscape-row"]'))
    .map((r) => r.getAttribute('data-paper-id')));
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function pollApiUntil(fn, timeout, interval = 500) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* transient */ }
    if (Date.now() >= deadline) return null;
    await sleep(interval);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/liit_workspace_${name}.png` });
}

// ---------------- ground truth (mirrors lib/landscapeFilter.ts) ----------------

const provTypes = (n) => {
  const t = (n.discovery || []).map((d) => d.type).filter(Boolean);
  if (t.length) return [...new Set(t)];
  return n.discovery_source ? [n.discovery_source] : [];
};

const freeUrl = (n) => {
  if (n.pdf_url) return n.pdf_url;
  if (n.arxiv_id) {
    const base = n.arxiv_id.replace(/^arxiv:/i, '').split('v')[0];
    return base ? `https://arxiv.org/pdf/${base}.pdf` : '';
  }
  return '';
};

const kwMatch = (n, kw) => {
  const terms = kw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [n.title, n.abstract, n.journal, ...(n.authors || []),
    n.doi, n.pmid, n.arxiv_id, ...(n.concepts || []), ...(n.methods || [])]
    .join('\n').toLowerCase();
  return terms.every((t) => hay.includes(t));
};

const SOURCE_LABELS = {
  citation: 'Citation', citation_discovery: 'Citation',
  cited_by: 'Cited-by', cited_by_discovery: 'Cited-by',
  semantic_similarity: 'Semantic similarity', semantic_discovery: 'Semantic similarity',
  pubmed_query: 'PubMed discovery', arxiv_query: 'arXiv discovery',
  user_import: 'Manual import', direct_import: 'Manual import', user_added: 'Manual import',
};
const provLabel = (t) => SOURCE_LABELS[t] ?? t;

function maxSimMap(edges) {
  const m = new Map();
  for (const e of edges) {
    if (e.relationship !== 'semantic_similarity' || e.similarity == null) continue;
    for (const id of [e.source, e.target]) {
      const prev = m.get(id);
      if (prev == null || e.similarity > prev) m.set(id, e.similarity);
    }
  }
  return m;
}

/** A word that exists in some abstract but in NO title — proves keyword
 * search covers non-title metadata. Returns [word, expectedCount]. */
function abstractOnlyWord(land) {
  const titles = land.nodes.map((n) => (n.title || '').toLowerCase());
  const candidates = [];
  for (const n of land.nodes) {
    for (const w of (n.abstract || '').toLowerCase().match(/[a-z]{7,}/g) || []) {
      if (titles.some((t) => t.includes(w))) continue;
      const expected = land.nodes.filter((x) => kwMatch(x, w)).length;
      if (expected >= 1 && expected < land.nodes.length) candidates.push([w, expected]);
    }
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0] || null;
}

// ---------------- UI flow helpers ----------------

async function goView(page, view) {
  await clickSel(page, `[data-testid="landscape-view-${view}"]`);
  await sleep(250);
}

/** Navigate to Landscape; accepts BOTH the workspace (toolbar) and the
 * truthful empty state (no toolbar yet). Retries the nav click — one
 * click can race a React re-render (e.g. right after project creation). */
async function ensureLandscape(page) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const ok = await pollUntil(page, () => Boolean(
      document.querySelector('[data-testid="landscape-toolbar"]')
      || document.querySelector('[data-testid="landscape-empty"]')), null, 4000);
    if (ok) break;
    if (Date.now() >= deadline) {
      const where = await page.evaluate(() => ({
        url: location.href,
        text: (document.body.textContent || '').slice(0, 300),
      }));
      throw new Error(`Landscape workspace did not render: url=${where.url} body="${where.text}"`);
    }
    await clickText(page, 'button', 'Landscape');
    await sleep(400);
  }
  await sleep(300);
}

async function resetFilters(page) {
  if (await count(page, '[data-testid="landscape-clear-filters"]') > 0) {
    await clickSel(page, '[data-testid="landscape-clear-filters"]');
    await sleep(250);
  }
}

/** Make the intended project the app's ACTIVE one — verified via the
 * sidebar header (div[title=<name>]). Project creation can race the
 * projects-list refresh, so if the header disagrees we explicitly pick
 * the row; throws with the observed header if selection never lands. */
async function ensureActiveProject(page, projectName) {
  const headerShows = () => pollUntil(page, (nm) => {
    const el = Array.from(document.querySelectorAll('div[title]'))
      .find((d) => d.getAttribute('title') === nm);
    return Boolean(el && (el.textContent || '').trim() === nm);
  }, projectName, 5000);
  if (await headerShows()) return;
  await clickText(page, 'button', 'Projects');
  await waitFor(page, 'Each project holds its own papers', 30000);
  await clickText(page, 'button', projectName);
  if (!(await headerShows())) {
    const hdr = await page.evaluate(() => {
      const el = document.querySelector('div[title]');
      return el ? `"${el.getAttribute('title')}" | "${(el.textContent || '').trim()}"` : 'none';
    });
    throw new Error(`active project never became "${projectName}" (header: ${hdr})`);
  }
}

async function createProjectUI(page, name) {
  await clickText(page, 'button', 'Projects');
  await waitFor(page, 'Each project holds its own papers', 30000);
  await clearInput(page, 'input[placeholder="New project name…"]');
  await page.type('input[placeholder="New project name…"]', name);
  await clickText(page, 'button', 'New project');
  const found = await pollApiUntil(async () => {
    const ps = await api('/api/projects');
    return ps.find((p) => p.name === name) || null;
  }, 30000, 500);
  if (!found) throw new Error(`project ${name} not created`);
  await ensureActiveProject(page, name);
  return found;
}

async function uploadPdfUI(page, projectId, pdfPath) {
  await clickText(page, 'button', 'Library');
  const sawUpload = await waitFor(page, 'Upload PDF', 30000);
  const probe = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim() === 'Upload PDF');
    const err = document.querySelector('[role="alert"], .error');
    return {
      inputs: inputs.length,
      btnFound: Boolean(btn),
      btnDisabled: btn ? btn.disabled : null,
      errText: err ? (err.textContent || '').slice(0, 200) : null,
    };
  });
  if (!sawUpload || !probe.btnFound || probe.btnDisabled || probe.inputs === 0) {
    throw new Error(`upload UI not ready: sawUpload=${sawUpload} `
      + `probe=${JSON.stringify(probe)} body="${(await body(page)).slice(0, 200)}"`);
  }
  const handle = await page.evaluateHandle(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((i) => (i.parentElement?.textContent || '').includes('Upload PDF'))
      || inputs[0];
  });
  const el = handle.asElement();
  if (!el) throw new Error('upload file input not found');
  // Watch the actual upload HTTP result so a failure says WHY.
  const uploadWatch = { code: null };
  const onResponse = (res) => {
    if (res.url().includes('/papers/upload')) uploadWatch.code = res.status();
  };
  page.on('response', onResponse);
  await el.uploadFile(pdfPath);
  const papers = await pollApiUntil(async () => {
    const ps = await api(`/api/projects/${projectId}/papers`);
    return ps.length >= 1 ? ps : null;
  }, 120000, 500);
  page.off('response', onResponse);
  if (!papers) {
    throw new Error(`seed upload never produced a paper (upload HTTP status=${uploadWatch.code}) `
      + `uiError="${probe.errText}"`);
  }
  return papers;
}

async function waitBuildComplete(projectId, timeoutMs = 300000) {
  const s = await pollApiUntil(async () => {
    const st = await api(`/api/projects/${projectId}/landscape/status`);
    return st.status === 'complete' || st.status === 'error' ? st : null;
  }, timeoutMs, 500);
  if (!s) throw new Error('landscape build never completed');
  if (s.status !== 'complete') {
    throw new Error(`landscape build status=${s.status} error=${s.error}`);
  }
  return s;
}

/** Wait until the UI counts element converges on the API truth. */
async function waitForUiCounts(page, nodes, edges, timeout = 30000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const c = await countsText(page);
    if (c && c.nodes === nodes && c.edges === edges) return c;
    if (Date.now() >= deadline) return null;
    await sleep(500);
  }
}

/** Navigate to Library and close any open detail so list-level text
 * (titles, count) can be asserted without detail-panel interference. */
async function libraryList(page) {
  await clickText(page, 'button', 'Library');
  await sleep(600);
  if (await count(page, 'button[title="Back to library list"]') > 0) {
    await clickSel(page, 'button[title="Back to library list"]');
    await sleep(400);
  }
}

/** Deterministic single-seed PDF: one nonsense page. No replay fixture
 * matches its metadata queries, so every discovery channel truthfully
 * reports nothing found — the run still completes (status "complete")
 * with exactly 1 node / 0 edges. */
function buildNonsensePdf(text) {
  const enc = (s) => Buffer.from(s, 'latin1');
  const esc = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 14 Tf 72 720 Td (${esc}) Tj ET\n`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${enc(stream).length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(enc(pdf).length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = enc(pdf).length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(pdf);
}

// ---------------- main ----------------

async function main() {
  // Preflight: the dev stack must already run (see header).
  try {
    const h = await fetch(`${API}/api/projects`);
    if (!h.ok) throw new Error(`backend unhealthy: ${h.status}`);
    const f = await fetch(BASE);
    if (!f.ok) throw new Error(`frontend unhealthy: ${f.status}`);
  } catch (e) {
    console.error(`PRE-FLIGHT FAILED: ${e.message}\nStart the stack first:\n`
      + '  backend:  LIT_REVIEW_DB=/tmp/liit_workspace.db LIIT_HTTP_REPLAY_DIR=Liit/fixtures/http \\\n'
      + '            .venv/bin/python -m uvicorn backend.app.main:app --port 8000\n'
      + '  frontend: vite dev on http://127.0.0.1:8443');
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

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await waitFor(page, 'Projects', 30000);

  // ================= SETUP: main project with a discovered landscape =================
  const ts = Date.now();
  const P1 = await createProjectUI(page, `landscape-ws-${ts}`);
  await uploadPdfUI(page, P1.id, SEED_PDF);
  await waitBuildComplete(P1.id);
  let land = await api(`/api/landscape/${P1.id}`);
  let N = land.nodes.length;
  const seedId = (await api(`/api/projects/${P1.id}/landscape/status`)).seed_paper_id;
  const discoveredAtRest = land.nodes.filter((n) => !n.in_project);
  const inProjectAtRest = land.nodes.filter((n) => n.in_project);
  console.log(`SETUP: project=${P1.name} nodes=${N} in_project=${inProjectAtRest.length} `
    + `discovered=${discoveredAtRest.length} seed=${seedId}`);

  await ensureLandscape(page);
  await goView(page, 'graph');
  await waitForUiCounts(page, N, land.edges.length);

  // ================= checks 1..8: discovery vs collection + membership =================
  const hdr = await labelText(page, 'landscape-counts');
  const graphNodes = await count(page, '.graph-node');
  check('1. counts header Landscape/In project/Discovered matches API; graph renders EVERY node',
    hdr === `Landscape ${N} · In project ${inProjectAtRest.length} · Discovered ${discoveredAtRest.length}`
      && discoveredAtRest.length >= 1 && graphNodes === N,
    `hdr="${hdr}" graph=${graphNodes}/${N}`);

  await goView(page, 'split');
  const discNode = discoveredAtRest[0];
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${discNode.id}"]`);
  await sleep(400);
  let t = await body(page);
  check('2. discovered node detail: "Discovered" + [+ Add to Project], never "In Project"',
    t.includes('Selected paper')
      && (await detailCount(page, 'landscape-in-project')) === 0
      && (await detailCount(page, 'landscape-discovered')) >= 1
      && (await detailCount(page, 'landscape-add-to-project')) >= 1,
    '');

  const seedNode = land.nodes.find((n) => n.id === seedId);
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${seedId}"]`);
  await sleep(400);
  t = await body(page);
  check('3. seed node detail shows "✓ In Project" (explicit upload = member)',
    (await detailCount(page, 'landscape-in-project')) >= 1
      && (await detailText(page)).includes(seedNode.title.slice(0, 40)),
    '');

  await libraryList(page);
  const bodyText = await body(page);
  const discoveredAbsent = discoveredAtRest.every((n) => !bodyText.includes(n.title.slice(0, 40)));
  check('4. Library shows ONLY explicit members (discovered titles absent + collection subtitle)',
    (await paperCount(page)) === inProjectAtRest.length && discoveredAbsent
      && (await count(page, '[data-testid="library-collection-subtitle"]')) === 1,
    `lib=${await paperCount(page)} expected=${inProjectAtRest.length}`);

  // Single [Add to Project] from the Landscape detail.
  await ensureLandscape(page);
  await goView(page, 'split');
  await waitForUiCounts(page, N, land.edges.length);
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${discNode.id}"]`);
  await sleep(400);
  const beforeAdd = JSON.stringify(await api(`/api/landscape/${P1.id}`));
  await clickSel(page, '[data-testid="landscape-detail"] [data-testid="landscape-add-to-project"]');
  const flipped = await pollUntil(page, () => Boolean(document.querySelector(
    '[data-testid="landscape-detail"] [data-testid="landscape-in-project"]')), null, 15000);
  const libAfter1 = await api(`/api/projects/${P1.id}/papers`);
  check('5. [+ Add to Project] flips to "✓ In Project" immediately; Library +1; same node id',
    flipped && libAfter1.some((p) => p.id === discNode.id)
      && libAfter1.length === inProjectAtRest.length + 1
      && (await rowIds(page)).includes(discNode.id),
    `lib=${libAfter1.length}`);

  const afterAdd = JSON.stringify(await api(`/api/landscape/${P1.id}`));
  const strip = (s) => JSON.stringify(JSON.parse(s).nodes.map((n) => ({ ...n, in_project: 0 })));
  const b4 = JSON.parse(beforeAdd);
  const af = JSON.parse(afterAdd);
  const sameDisc = JSON.stringify(b4.nodes.find((n) => n.id === discNode.id).discovery)
    === JSON.stringify(af.nodes.find((n) => n.id === discNode.id).discovery);
  check('6. add preserves everything else: same nodes/edges/ids/provenance (no dupes)',
    strip(beforeAdd) === strip(afterAdd)
      && JSON.stringify(b4.edges) === JSON.stringify(af.edges) && sameDisc
      && af.nodes.length === N,
    `nodes ${b4.nodes.length}->${af.nodes.length}`);

  // Bulk add (checkboxes in List/Split) -> exact toast format.
  const stillDisc = af.nodes.filter((n) => !n.in_project).slice(0, 2);
  let bulkOk = false;
  let toastText = '';
  if (stillDisc.length >= 1) {
    for (const n of stillDisc) {
      await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${n.id}"] input[data-testid="landscape-row-select"]`);
      await sleep(150);
    }
    const barShown = (await count(page, '[data-testid="landscape-bulk-bar"]')) > 0
      && (await body(page)).includes(`${stillDisc.length} selected`);
    await clickSel(page, '[data-testid="landscape-bulk-add"]');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !toastText) {
      toastText = await labelText(page, 'landscape-toast') || '';
      if (!toastText) await sleep(250);
    }
    bulkOk = barShown
      && toastText.includes(`${stillDisc.length} paper${stillDisc.length === 1 ? '' : 's'} added to ${P1.name}.`);
    await sleep(400);
  }
  check('7. bulk add: checkboxes -> true counts + exact "N papers added to <project>." toast',
    bulkOk, `selected=${stillDisc.length} toast="${toastText}"`);

  const libAfterBulk = await api(`/api/projects/${P1.id}/papers`);
  const landAfterBulk = await api(`/api/landscape/${P1.id}`);
  const rowsNow = await rowIds(page);
  const bulkFlipped = stillDisc.length >= 1 && stillDisc.every((n) => rowsNow.includes(n.id))
    && (await count(page, '[data-testid="landscape-row"] [data-testid="landscape-in-project"]'))
      >= stillDisc.length;
  check('8. bulk-added rows flip to "✓ In Project"; collection +N; NO duplicate landscape nodes',
    bulkFlipped && libAfterBulk.length === libAfter1.length + stillDisc.length
      && landAfterBulk.nodes.length === N
      && new Set(landAfterBulk.nodes.map((n) => n.id)).size === N,
    `lib=${libAfterBulk.length} nodes=${landAfterBulk.nodes.length}`);

  // ================= checks 9..12: three views =================
  const btnCount = await page.evaluate(() => ['graph', 'split', 'list']
    .filter((v) => document.querySelector(`[data-testid="landscape-view-${v}"]`)).length);
  await goView(page, 'graph');
  const inGraph = (await count(page, '.graph-area')) === 1
    && (await count(page, '[data-testid="landscape-list"]')) === 0;
  await goView(page, 'list');
  const inList = (await count(page, '[data-testid="landscape-list"]')) === 1
    && (await count(page, '.graph-area')) === 0;
  await goView(page, 'split');
  const inSplit = (await count(page, '[data-testid="landscape-list"]')) === 1
    && (await count(page, '.graph-area')) === 0;
  check('9. persistent view switcher: Graph / Split / List each render their surface',
    btnCount === 3 && inGraph && inList && inSplit, `btns=${btnCount}`);

  await goView(page, 'list');
  const headers = await page.evaluate(() => Array.from(
    document.querySelectorAll('[data-testid="landscape-list"] th'))
    .map((th) => (th.textContent || '').trim()));
  const wantHeaders = ['Paper', 'Journal · Year', 'Identifiers', 'Pub type', 'Full text',
    'Citations', 'Discovered via', 'Similarity', 'Status', 'Open'];
  const rows = await rowIds(page);
  const absNode = land.nodes.find((n) => (n.abstract || '').length > 60);
  const absFrag = absNode ? absNode.abstract.slice(0, 50) : '';
  const hasAbstract = !absNode || await page.evaluate(([id, frag]) => {
    const row = document.querySelector(`[data-testid="landscape-row"][data-paper-id="${id}"]`);
    return Boolean(row && (row.textContent || '').includes(frag));
  }, [absNode.id, absFrag]);
  check('10. dense List: all metadata columns, rows == filtered set, abstract shown',
    wantHeaders.every((h) => headers.some((x) => x.includes(h)))
      && rows.length === N && hasAbstract,
    `headers=[${headers.join('|')}] rows=${rows.length}`);

  await goView(page, 'split');
  const urlBefore = page.url();
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${discNode.id}"]`);
  await sleep(400);
  t = await body(page);
  check('11. Split shows detail + "Discovered through" + relationships WITHOUT leaving Landscape',
    t.includes('Selected paper') && t.includes('Discovered through')
      && t.includes('Relationships')
      && (await count(page, '[data-testid="landscape-toolbar"]')) === 1
      && page.url() === urlBefore,
    '');

  await goView(page, 'list');
  await sleep(300);
  await page.reload({ waitUntil: 'networkidle2' });
  await ensureLandscape(page);
  const persisted = (await page.evaluate(() => localStorage.getItem('liit.landscape.view'))) === 'list'
    && (await count(page, '[data-testid="landscape-list"]')) === 1
    && (await count(page, '.graph-area')) === 0;
  check('12. view choice persists across reload (localStorage liit.landscape.view)',
    persisted, await page.evaluate(() => localStorage.getItem('liit.landscape.view')));

  // ================= checks 13..24: filters (API-derived expectations) =================
  land = await api(`/api/landscape/${P1.id}`);
  N = land.nodes.length;
  await resetFilters(page);
  await goView(page, 'list');

  const absWord = abstractOnlyWord(land);
  if (absWord) {
    const [word, expected] = absWord;
    await clearInput(page, 'input[data-testid="landscape-filter-keyword"]');
    await page.type('input[data-testid="landscape-filter-keyword"]', word);
    await sleep(500);
    const rowsK = await rowIds(page);
    const summ = await labelText(page, 'landscape-filter-summary');
    const matchNode = land.nodes.find((n) => kwMatch(n, word)) || {};
    check('13. keyword matches NON-TITLE metadata (abstract word absent from every title)',
      rowsK.length === expected && summ === `${expected} of ${N} papers`
        && rowsK.includes(matchNode.id),
      `word=${word} rows=${rowsK.length}/${expected}`);
    await clearInput(page, 'input[data-testid="landscape-filter-keyword"]');
    await page.type('input[data-testid="landscape-filter-keyword"]', `${word} zzz-no-match`);
    await sleep(500);
    const zeroRows = (await rowIds(page)).length === 0
      && (await body(page)).includes('No papers match the current filters.');
    await resetFilters(page);
    await sleep(300);
    const restored = (await rowIds(page)).length === N;
    check('14. multi-term AND semantics + [Clear filters] restores the full set',
      zeroRows && restored, `after clear=${(await rowIds(page)).length}/${N}`);
  } else {
    check('13. keyword matches NON-TITLE metadata (abstract word absent from every title)',
      false, 'no abstract-only word available');
    check('14. multi-term AND semantics + [Clear filters] restores the full set',
      false, 'no abstract-only word available');
  }

  const yearOpts = await page.evaluate(() => Array.from(
    document.querySelector('select[data-testid="landscape-filter-year-from"]')?.options || [])
    .map((o) => o.value));
  const toOpts = await page.evaluate(() => Array.from(
    document.querySelector('select[data-testid="landscape-filter-year-to"]')?.options || [])
    .map((o) => o.value));
  const dataYears = [...new Set(land.nodes.map((n) => n.year).filter((y) => y != null))]
    .sort((a, b) => a - b);
  const yearOk = dataYears.length >= 1
    && dataYears.every((y) => yearOpts.includes(String(y)) && toOpts.includes(String(y)))
    && yearOpts.includes(String(CURRENT_YEAR)) && toOpts.includes(String(CURRENT_YEAR));
  check('15. year From/To options are DYNAMIC (all data years + current year, never hard-coded)',
    yearOk, `opts=[${yearOpts.join(',')}] data=[${dataYears.join(',')}] current=${CURRENT_YEAR}`);

  const byYear = new Map();
  land.nodes.forEach((n) => byYear.set(n.year, (byYear.get(n.year) || 0) + 1));
  const exactYear = [...byYear.entries()].filter(([y]) => y != null)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? CURRENT_YEAR;
  await setSelectBy(page, 'select[data-testid="landscape-filter-year-from"]', exactYear);
  await setSelectBy(page, 'select[data-testid="landscape-filter-year-to"]', exactYear);
  await sleep(400);
  const exactExpected = land.nodes.filter((n) => n.year === exactYear).length;
  const nullYears = land.nodes.filter((n) => n.year == null).length;
  const summY = await labelText(page, 'landscape-filter-summary');
  const rowsY = (await rowIds(page)).length;
  const yearNoteOk = nullYears === 0
    || (await body(page)).includes('have no recorded year');
  await resetFilters(page);
  check('16. year exact (From=To): only that year; null-year papers excluded with note',
    summY === `${exactExpected} of ${N} papers` && rowsY === exactExpected && yearNoteOk,
    `year=${exactYear} rows=${rowsY}/${exactExpected}`);

  if (dataYears.length >= 2) {
    await setSelectBy(page, 'select[data-testid="landscape-filter-year-from"]', dataYears[0]);
    await setSelectBy(page, 'select[data-testid="landscape-filter-year-to"]', dataYears[1]);
    await sleep(400);
    const rangeExpected = land.nodes
      .filter((n) => n.year != null && n.year >= dataYears[0] && n.year <= dataYears[1]).length;
    const summR2 = await labelText(page, 'landscape-filter-summary');
    const rowsR2 = (await rowIds(page)).length;
    await resetFilters(page);
    check('17. year range: From<=year<=To matches the API-derived count',
      summR2 === `${rangeExpected} of ${N} papers` && rowsR2 === rangeExpected,
      `range=[${dataYears[0]},${dataYears[1]}] rows=${rowsR2}/${rangeExpected}`);
  } else {
    check('17. year range: From<=year<=To matches the API-derived count',
      true, 'only one data year — exact-year check covers the bounds');
  }

  const journals = new Map();
  land.nodes.forEach((n) => { if (n.journal) journals.set(n.journal, (journals.get(n.journal) || 0) + 1); });
  if (journals.size > 0) {
    const [topName, topCount] = [...journals.entries()].sort((a, b) => b[1] - a[1])[0];
    const labels = await page.evaluate(() => Array.from(
      document.querySelectorAll('label[data-testid="landscape-journal-option"]'))
      .map((l) => (l.textContent || '').trim()));
    const labelsMatch = [...journals.entries()]
      .every(([j, c]) => labels.some((l) => l === `${j} (${c})`));
    await toggleLabel(page, 'landscape-journal-option', `${topName} (${topCount})`);
    await sleep(400);
    const summJ = await labelText(page, 'landscape-filter-summary');
    const rowsJ = (await rowIds(page)).length;
    await resetFilters(page);
    check('18. journal options carry TRUE counts; selecting one narrows to exactly those papers',
      labelsMatch && summJ === `${topCount} of ${N} papers` && rowsJ === topCount,
      `journal=${topName} rows=${rowsJ}/${topCount}`);
  } else {
    check('18. journal options carry TRUE counts (honestly absent when no journal data)',
      (await count(page, 'label[data-testid="landscape-journal-option"]')) === 0,
      'no journal metadata in data');
  }

  // Retraction: excludes ONLY source-typed retracted; unknowns never excluded.
  const rTrue = land.nodes.filter((n) => n.retracted === true);
  const rNull = land.nodes.filter((n) => n.retracted == null);
  await toggleLabel(page, 'landscape-filter-retracted', 'Exclude retracted');
  await sleep(400);
  const summRet = await labelText(page, 'landscape-filter-summary');
  const retractionNoteOk = rNull.length === 0
    ? true
    : (await body(page)).includes(`Retraction status unavailable for ${rNull.length} paper`)
      && (await body(page)).includes('— not excluded.');
  await resetFilters(page);
  check('19. exclude-retracted removes ONLY source-typed papers; unknowns never excluded (noted)',
    summRet === `${N - rTrue.length} of ${N} papers` && retractionNoteOk,
    `retracted=${rTrue.length} unknown=${rNull.length} summ="${summRet}"`);

  const typeCounts = new Map();
  land.nodes.forEach((n) => (n.pub_types || [])
    .forEach((ty) => typeCounts.set(ty, (typeCounts.get(ty) || 0) + 1)));
  const untyped = land.nodes.filter((n) => (n.pub_types || []).length === 0).length;
  if (typeCounts.size > 0) {
    const [topType, typeCount] = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const labels = await page.evaluate(() => Array.from(
      document.querySelectorAll('label[data-testid="landscape-filter-pubtype"]'))
      .map((l) => (l.textContent || '').trim()));
    const labelsMatch = [...typeCounts.entries()]
      .every(([ty, c]) => labels.some((l) => l === `${ty} (${c})`));
    await toggleLabel(page, 'landscape-filter-pubtype', `${topType} (${typeCount})`);
    await sleep(400);
    const summT = await labelText(page, 'landscape-filter-summary');
    const pubNoteOk = untyped === 0
      || (await body(page)).includes(`Publication type unavailable for ${untyped} paper`);
    await resetFilters(page);
    check('20. publication-type filter uses ONLY data-supported types (counts + untyped note)',
      labelsMatch && summT === `${typeCount} of ${N} papers` && pubNoteOk,
      `type=${topType} expected=${typeCount}`);
  } else {
    check('20. publication-type filter uses ONLY data-supported types (counts + untyped note)',
      (await count(page, 'label[data-testid="landscape-filter-pubtype"]')) === 0,
      'no publication-type metadata');
  }

  const ftSets = {
    metadata: land.nodes.filter((n) => n.metadata_only),
    free: land.nodes.filter((n) => freeUrl(n)),
    local: land.nodes.filter((n) => !n.metadata_only),
  };
  const ftKind = ['metadata', 'free', 'local'].find((k) => ftSets[k].length > 0);
  const ftLabel = { metadata: 'Metadata only', free: 'Free full text', local: 'Full text available' };
  await toggleLabel(page, 'landscape-filter-fulltext', ftLabel[ftKind]);
  await sleep(400);
  const summF = await labelText(page, 'landscape-filter-summary');
  await resetFilters(page);
  check('21. open-access/full-text filter matches the stored full-text state exactly',
    summF === `${ftSets[ftKind].length} of ${N} papers`,
    `kind=${ftKind} expected=${ftSets[ftKind].length} summ="${summF}"`);

  // Author: pick a discriminating token; expectation mirrors the UI predicate.
  const tokens = [...new Set(land.nodes.flatMap((n) => (n.authors || [])
    .flatMap((a) => a.split(/\s+/)).map((s) => s.toLowerCase().trim()))
    .filter((s) => s.length >= 4))];
  let authorWord = tokens
    .map((w) => [w, land.nodes.filter((n) => (n.authors || [])
      .some((a) => a.toLowerCase().includes(w))).length])
    .find(([, c]) => c >= 1 && c < N)?.[0] || tokens[0] || null;
  if (authorWord) {
    const authorExpected = land.nodes.filter((n) => (n.authors || [])
      .some((a) => a.toLowerCase().includes(authorWord))).length;
    await clearInput(page, 'input[data-testid="landscape-filter-author"]');
    await page.type('input[data-testid="landscape-filter-author"]', authorWord);
    await sleep(400);
    const summA = await labelText(page, 'landscape-filter-summary');
    const rowsA = (await rowIds(page)).length;
    await resetFilters(page);
    check('22. author filter narrows to papers whose stored authors contain the name',
      summA === `${authorExpected} of ${N} papers` && rowsA === authorExpected,
      `author=${authorWord} rows=${rowsA}/${authorExpected}`);
  } else {
    check('22. author filter narrows to papers whose stored authors contain the name',
      (await count(page, 'input[data-testid="landscape-filter-author"]')) === 1,
      'no author metadata — control present, nothing to filter');
  }

  const srcCounts = new Map();
  land.nodes.forEach((n) => provTypes(n)
    .forEach((s) => srcCounts.set(s, (srcCounts.get(s) || 0) + 1)));
  const srcLabels = await page.evaluate(() => Array.from(
    document.querySelectorAll('label[data-testid="landscape-filter-source"]'))
    .map((l) => (l.textContent || '').trim()));
  const srcLabelMatch = [...srcCounts.entries()]
    .every(([s, c]) => srcLabels.some((l) => l === `${provLabel(s)} (${c})`));
  const [topSrc, srcCount] = [...srcCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  await toggleLabel(page, 'landscape-filter-source', `${provLabel(topSrc)} (${srcCount})`);
  await sleep(400);
  const summS = await labelText(page, 'landscape-filter-summary');
  await resetFilters(page);
  check('23. discovery-source options = stored provenance with true counts; selecting narrows',
    srcLabelMatch && summS === `${srcCount} of ${N} papers`,
    `src=${provLabel(topSrc)} expected=${srcCount} summ="${summS}"`);

  // Relationship type (Graph view for edge rendering) — uncheck + restore.
  await goView(page, 'graph');
  await sleep(300);
  await toggleLabel(page, 'landscape-filter-relationship', 'semantic similarity');
  await sleep(400);
  const semGone = (await count(page, '.graph-edge-hit[data-rel="semantic_similarity"]')) === 0;
  let c = await countsText(page);
  const nonSemEdges = land.edges.filter((e) => e.relationship !== 'semantic_similarity').length;
  const offOk = semGone && c && c.edges === nonSemEdges;
  await toggleLabel(page, 'landscape-filter-relationship', 'semantic similarity');
  await sleep(400);
  c = await countsText(page);
  const onOk = c && c.edges === land.edges.length
    && (await count(page, '.graph-edge-hit[data-rel="semantic_similarity"]'))
      === land.edges.filter((e) => e.relationship === 'semantic_similarity').length;
  await resetFilters(page);
  check('24. relationship filter removes semantic edges from the graph (+counts) and restores',
    offOk && onOk, `off=${JSON.stringify(c)} non_semantic=${nonSemEdges}`);

  // ================= checks 25..27: sorting =================
  const sortOpts = await page.evaluate(() => Array.from(
    document.querySelector('select[data-testid="landscape-sort-by"]')?.options || [])
    .map((o) => o.value));
  const wantSorts = ['relevance', 'citation_count', 'year', 'title', 'journal', 'similarity',
    'recently_discovered'];
  await goView(page, 'list');
  await setSelectBy(page, 'select[data-testid="landscape-sort-by"]', 'year');
  await sleep(400);
  const dirLabel = await page.evaluate(() => {
    const sel = document.querySelector('select[data-testid="landscape-sort-dir"]');
    return sel ? sel.options[sel.selectedIndex].textContent : '';
  });
  const yearSeq = (await rowIds(page)).map((id) => {
    const n = land.nodes.find((x) => x.id === id);
    return n ? n.year : null;
  });
  const nonNull = yearSeq.filter((y) => y != null);
  const nullIdx = yearSeq.findIndex((y) => y == null);
  const descOk = nonNull.every((y, i) => i === 0 || nonNull[i - 1] >= y)
    && (nullIdx === -1 || yearSeq.slice(nullIdx).every((y) => y == null));
  check('25. Sort By has all 7 options; Year = Newest → Oldest with null-year papers last',
    wantSorts.every((s) => sortOpts.includes(s))
      && dirLabel.includes('Newest → Oldest') && descOk,
    `opts=[${sortOpts.join(',')}] dir="${dirLabel}" seq=[${yearSeq.join(',')}]`);

  const allNullCitations = land.nodes.every((n) => n.citation_count == null);
  await setSelectBy(page, 'select[data-testid="landscape-sort-by"]', 'citation_count');
  await sleep(400);
  t = await body(page);
  const citNoteOk = t.includes('Citation count unavailable for these papers — order unchanged.');
  const citCells = await page.evaluate(() => (document.body.textContent || '')
    .split('Citation count unavailable').length - 1);
  check('26. citation sort is HONEST: no invented counts, order unchanged, explicit note',
    allNullCitations && citNoteOk && citCells >= (await rowIds(page)).length,
    `api_all_null=${allNullCitations} note=${citNoteOk} cells=${citCells}`);

  const sims = maxSimMap(land.edges);
  await setSelectBy(page, 'select[data-testid="landscape-sort-by"]', 'similarity');
  await sleep(400);
  const simSeq = (await rowIds(page)).map((id) => sims.get(id) ?? null);
  let simOrderOk = true;
  let seenNull = false;
  for (const v of simSeq) {
    if (v == null) { seenNull = true; continue; }
    if (seenNull) { simOrderOk = false; break; }
  }
  const scored = simSeq.filter((v) => v != null);
  for (let i = 1; i < scored.length; i++) if (scored[i - 1] < scored[i]) simOrderOk = false;
  const missing = land.nodes.filter((n) => !sims.has(n.id)).length;
  const simNoteOk = missing === 0
    || (await body(page)).includes('have no semantic-similarity score (shown last).');
  check('27. similarity sort uses ONLY stored scores: desc first, unscored last + note',
    simOrderOk && simNoteOk, `scored=${scored.length} missing=${missing}`);

  // ================= checks 28..31: one filtered set / summary / edges =================
  await resetFilters(page);
  const word28 = absWord ? absWord[0] : null;
  const expected28 = word28 ? land.nodes.filter((n) => kwMatch(n, word28)).length : 0;
  if (word28 && expected28 >= 1 && expected28 < N) {
    await page.type('input[data-testid="landscape-filter-keyword"]', word28);
    await sleep(500);
    const listRows = (await rowIds(page)).length;
    await goView(page, 'split');
    await sleep(300);
    const splitRows = (await rowIds(page)).length;
    await goView(page, 'graph');
    await sleep(300);
    const gCounts = await countsText(page);
    const filteredIds = new Set(land.nodes.filter((n) => kwMatch(n, word28)).map((n) => n.id));
    const expEdges = land.edges
      .filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target)).length;
    check('28. ONE filtered set drives Graph + List + Split (same nodes, edge-consistent)',
      listRows === expected28 && splitRows === expected28
        && gCounts && gCounts.nodes === expected28 && gCounts.edges === expEdges,
      `list=${listRows} split=${splitRows} graph=${JSON.stringify(gCounts)} exp=${expected28}/${expEdges}`);

    const summ28 = await labelText(page, 'landscape-filter-summary');
    const chips28 = await labelText(page, 'landscape-filter-chips');
    check('29. filter summary "x of N papers" + active-filter chips + [Clear filters] present',
      summ28 === `${expected28} of ${N} papers` && Boolean(chips28)
        && chips28.includes(word28)
        && (await count(page, '[data-testid="landscape-clear-filters"]')) === 1,
      summ28);
    await resetFilters(page);
    await sleep(300);
    const summCleared = await labelText(page, 'landscape-filter-summary');
    check('30. [Clear filters] returns to the full set (N of N) and drops the chips',
      summCleared === `${N} of ${N} papers`
        && (await labelText(page, 'landscape-filter-chips')) === null,
      summCleared);

    // Graph drops excluded nodes AND their edges — visualization only.
    const landPre = JSON.stringify(await api(`/api/landscape/${P1.id}`));
    await page.type('input[data-testid="landscape-filter-keyword"]', word28);
    await sleep(500);
    const g2 = await countsText(page);
    const landPost = JSON.stringify(await api(`/api/landscape/${P1.id}`));
    check('31. graph filtering removes excluded nodes AND their edges; DB untouched (no deletion)',
      g2 && g2.nodes === expected28 && g2.edges === expEdges && landPre === landPost,
      `g=${JSON.stringify(g2)} db_same=${landPre === landPost}`);
    await resetFilters(page);
  } else {
    check('28. ONE filtered set drives Graph + List + Split (same nodes, edge-consistent)',
      false, 'no abstract-only keyword available');
    check('29. filter summary "x of N papers" + active-filter chips + [Clear filters] present',
      false, 'no abstract-only keyword available');
    check('30. [Clear filters] returns to the full set (N of N) and drops the chips',
      false, 'no abstract-only keyword available');
    check('31. graph filtering removes excluded nodes AND their edges; DB untouched (no deletion)',
      false, 'no abstract-only keyword available');
  }

  // ================= checks 32..34: detail facts + counts after membership changes =====
  // Keep ONE paper discovered so the discovered-state detail stays provable.
  land = await api(`/api/landscape/${P1.id}`);
  let reserveNode = land.nodes.find((n) => !n.in_project) || null;
  if (!reserveNode) {
    const victim = land.nodes.find((n) => n.id !== seedId && n.in_project);
    if (victim) {
      await api(`/api/projects/${P1.id}/papers/${victim.id}/collection`, { method: 'DELETE' });
      land = await api(`/api/landscape/${P1.id}`);
      reserveNode = land.nodes.find((n) => !n.in_project) || null;
    }
  }
  N = land.nodes.length;
  const mNow = land.nodes.filter((n) => n.in_project).length;
  const kNow = N - mNow;

  await goView(page, 'split');
  await waitForUiCounts(page, N, land.edges.length);
  const seedNode2 = land.nodes.find((n) => n.id === seedId);
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${seedId}"]`);
  await sleep(500);
  const retTexts = ['Retracted (PubMed publication type)',
    'Not retracted (PubMed publication type)', 'Retraction status unavailable'];
  const retEl = await labelText(page, 'landscape-retraction');
  const dText = await detailText(page);
  const idsOk = (seedNode2.doi && dText.includes(`DOI ${seedNode2.doi}`))
    || (seedNode2.pmid && dText.includes(`PMID ${seedNode2.pmid}`))
    || (!seedNode2.doi && !seedNode2.pmid && !seedNode2.arxiv_id && dText.includes('No identifiers'));
  check('32. detail shows full metadata: identifiers, citation-unavailable, retraction truth, type',
    dText.includes('Selected paper')
      && dText.includes(seedNode2.journal || 'Journal not available')
      && idsOk
      && dText.includes('Citation count unavailable')
      && retTexts.includes(retEl || '')
      && dText.includes('Publication type:')
      && (await detailCount(page, 'landscape-in-project')) >= 1,
    `retraction="${retEl}"`);

  let provOk = false;
  let relExpected = '';
  if (reserveNode) {
    await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${reserveNode.id}"]`);
    await sleep(500);
    const relCounts = await labelText(page, 'landscape-rel-counts');
    const nEdges = land.edges.filter((e) => e.source === reserveNode.id || e.target === reserveNode.id);
    const expCites = nEdges.filter((e) => e.relationship === 'cites' && e.source === reserveNode.id).length;
    const expCitedBy = nEdges.filter((e) => e.relationship === 'cites' && e.target === reserveNode.id).length;
    const expSim = nEdges.filter((e) => e.relationship === 'semantic_similarity').length;
    relExpected = `Cites ${expCites} paper${expCites === 1 ? '' : 's'} · Cited by ${expCitedBy} · Semantic similarity ${expSim}`;
    const rd = await detailText(page);
    const seedTitle = (land.nodes.find((n) => n.id === seedId) || {}).title || '@@no-seed@@';
    const viaOk = reserveNode.discovery.some((d) => d.source_paper_id)
      ? rd.includes('via ') && rd.includes(seedTitle)
      : true;
    provOk = rd.includes('Discovered through') && viaOk
      && relCounts === relExpected
      && rd.includes('Open Paper')
      && (await detailCount(page, 'landscape-add-to-project')) === 1;
  }
  check('33. detail provenance ("Discovered through" + via seed) + relationship counts + Open Paper',
    provOk, reserveNode ? `rel="${relExpected}"` : 'no discovered paper left to inspect');

  const hdrNow = await labelText(page, 'landscape-counts');
  check('34. counts header tracks membership changes exactly (Landscape/In project/Discovered)',
    hdrNow === `Landscape ${N} · In project ${mNow} · Discovered ${kNow}`,
    hdrNow);

  // ================= check 35: explicit no-match state (still on P1) =================
  await resetFilters(page);
  await waitForUiCounts(page, N, land.edges.length);
  await page.type('input[data-testid="landscape-filter-keyword"]', 'zzz-no-match-123');
  await sleep(500);
  t = await body(page);
  const summ35 = await labelText(page, 'landscape-filter-summary');
  await resetFilters(page);
  check('35. non-matching filter shows the explicit no-match state + "0 of N papers"',
    t.includes('No papers match the current filters.') && summ35 === `0 of ${N} papers`,
    summ35);

  // ================= check 36: truthful empty landscape =================
  const Pempty = await createProjectUI(page, `landscape-ws-empty-${ts}`);
  await ensureLandscape(page);
  t = await body(page);
  check('36. empty landscape invites a seed (spec string; never "Add more papers")',
    t.includes('Add a seed paper to begin exploring the research landscape.')
      && !t.includes('Add more papers'),
    `project=${Pempty.name}`);

  // ================= check 37: single-seed COMPLETE messages =================
  const nonsensePdf = `${os.tmpdir()}/liit_workspace_single_seed_${ts}.pdf`;
  writeFileSync(nonsensePdf, buildNonsensePdf('Zzyqx Quantum Foobarrot Nonsense Seed Paper'));
  const Psingle = await createProjectUI(page, `landscape-ws-single-${ts}`);
  await uploadPdfUI(page, Psingle.id, nonsensePdf);
  await waitBuildComplete(Psingle.id, 240000);
  const sLand = await api(`/api/landscape/${Psingle.id}`);
  await ensureLandscape(page);
  await waitForUiCounts(page, sLand.nodes.length, sLand.edges.length);
  t = await body(page);
  check('37. single-seed landscape (build complete): all three truthful no-discovery messages',
    sLand.nodes.length === 1
      && t.includes('1 paper in landscape.')
      && t.includes('1 paper found. No additional discoveries were available.')
      && t.includes('No additional relationships were discovered.'),
    `nodes=${sLand.nodes.length} edges=${sLand.edges.length}`);

  // ================= REAL-USER ACCEPTANCE: 19 steps =================
  console.log('--- ACCEPTANCE (19 steps): DISCOVERED != ADDED TO PROJECT ---');
  const A = await createProjectUI(page, `acceptance-${ts}`);
  step('A1. researcher creates a new project', Boolean(A.id), A.name);

  await uploadPdfUI(page, A.id, SEED_PDF);
  step('A2. uploads ONE seed PDF (the only manual discovery action)',
    (await api(`/api/projects/${A.id}/papers`)).length === 1, '');

  const aStatus = await pollApiUntil(async () => {
    const s = await api(`/api/projects/${A.id}/landscape/status`);
    return s.status !== 'idle' ? s : null;
  }, 30000, 250);
  step('A3. automatic discovery starts with no further action', aStatus !== null,
    aStatus ? aStatus.status : 'still idle');

  const aFinal = await waitBuildComplete(A.id);
  let aLand = await api(`/api/landscape/${A.id}`);
  const aNodeCount0 = aLand.nodes.length;
  const aSeed = aFinal.seed_paper_id;
  const aDisc = aLand.nodes.filter((n) => !n.in_project);
  const aM0 = aLand.nodes.filter((n) => n.in_project).length;
  await ensureLandscape(page);
  await waitForUiCounts(page, aNodeCount0, aLand.edges.length);
  const aHdr = await labelText(page, 'landscape-counts');
  step('A4. header reports discoveries as "Discovered" — discovered != member',
    aDisc.length >= 1 && aM0 === 1
      && aHdr === `Landscape ${aNodeCount0} · In project 1 · Discovered ${aDisc.length}`,
    aHdr);

  await libraryList(page);
  const aBody5 = await body(page);
  step('A5. Library still holds ONLY the seed — nothing was auto-added',
    (await paperCount(page)) === 1
      && aDisc.every((n) => !aBody5.includes(n.title.slice(0, 40))),
    `lib=${await paperCount(page)} discovered=${aDisc.length}`);

  await ensureLandscape(page);
  await goView(page, 'list');
  await sleep(300);
  const aSeedInLib = await count(page, '[data-testid="landscape-row"] [data-testid="landscape-in-project"]');
  const aDiscChips = await count(page, '[data-testid="landscape-row"] [data-testid="landscape-discovered"]');
  const aAddBtns = await count(page, '[data-testid="landscape-row"] [data-testid="landscape-add-to-project"]');
  step('A6. List shows seed "✓ In Project" and each discovery "Discovered + Add"',
    aSeedInLib >= 1 && aDiscChips === aDisc.length && aAddBtns === aDisc.length,
    `in=${aSeedInLib} disc=${aDiscChips}/${aDisc.length} add=${aAddBtns}`);

  const aDisc0 = aDisc[0];
  await goView(page, 'split');
  await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${aDisc0.id}"]`);
  await sleep(500);
  const at7 = await body(page);
  step('A7. Split shows the discovered paper IN-PLACE (metadata/provenance/relationships)',
    at7.includes('Selected paper') && at7.includes('Discovered through')
      && at7.includes('Relationships')
      && (await count(page, '[data-testid="landscape-toolbar"]')) === 1, '');

  await clickSel(page, '[data-testid="landscape-detail"] [data-testid="landscape-add-to-project"]');
  const aFlipped = await pollUntil(page, () => Boolean(document.querySelector(
    '[data-testid="landscape-detail"] [data-testid="landscape-in-project"]')), null, 15000);
  step('A8. [+ Add to Project] flips to "✓ In Project" immediately (single click)', aFlipped, '');

  await clickText(page, 'button', 'Library');
  await sleep(600);
  step('A9. Library now shows 2 papers (the added discovery)',
    (await paperCount(page)) === 2, `lib=${await paperCount(page)}`);

  await ensureLandscape(page);
  aLand = await api(`/api/landscape/${A.id}`);
  const aAdded = aLand.nodes.find((n) => n.id === aDisc0.id);
  const rowsA10 = await rowIds(page);
  step('A10. paper never leaves the Landscape: node + provenance + edges intact',
    aLand.nodes.length === aNodeCount0
      && Boolean(aAdded) && aAdded.in_project === true
      && JSON.stringify(aAdded.discovery) === JSON.stringify(aDisc0.discovery)
      && rowsA10.includes(aDisc0.id),
    `nodes=${aLand.nodes.length}/${aNodeCount0}`);

  let aRest = aLand.nodes.filter((n) => !n.in_project && n.id !== aSeed).slice(0, 2);
  if (aRest.length === 0) {
    // Restore a discovered state so the bulk flow stays provable.
    await goView(page, 'split');
    await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${aDisc0.id}"]`);
    await sleep(400);
    await clickSel(page, '[data-testid="landscape-detail"] [data-testid="landscape-remove"]');
    await pollApiUntil(async () => {
      const L = await api(`/api/landscape/${A.id}`);
      return L.nodes.find((n) => n.id === aDisc0.id)?.in_project === false ? L : null;
    }, 15000, 300);
    aRest = [aDisc0];
    aLand = await api(`/api/landscape/${A.id}`);
  }
  await goView(page, 'list');
  for (const n of aRest) {
    await clickSel(page, `[data-testid="landscape-row"][data-paper-id="${n.id}"] input[data-testid="landscape-row-select"]`);
    await sleep(150);
  }
  const aBar = (await count(page, '[data-testid="landscape-bulk-bar"]')) > 0
    && (await body(page)).includes(`${aRest.length} selected`);
  step('A11. selecting discoveries shows the bulk bar with true counts',
    aBar && aRest.length >= 1, `selected=${aRest.length}`);

  await clickSel(page, '[data-testid="landscape-bulk-add"]');
  let aToast = '';
  {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !aToast) {
      aToast = await labelText(page, 'landscape-toast') || '';
      if (!aToast) await sleep(250);
    }
  }
  step('A12. bulk add confirms "N papers added to <project>."',
    aToast.includes(`${aRest.length} paper${aRest.length === 1 ? '' : 's'} added to ${A.name}.`),
    aToast);

  const aLib = await api(`/api/projects/${A.id}/papers`);
  aLand = await api(`/api/landscape/${A.id}`);
  const aM = aLand.nodes.filter((n) => n.in_project).length;
  await clickText(page, 'button', 'Library');
  await sleep(600);
  const aUiLib = await paperCount(page);
  await ensureLandscape(page);
  const aHdr2 = await labelText(page, 'landscape-counts');
  step('A13. Library count and header "In project" both agree with the API',
    aLib.length === 2 + aRest.length && aUiLib === aLib.length
      && aHdr2 === `Landscape ${aLand.nodes.length} · In project ${aM} · Discovered ${aLand.nodes.length - aM}`,
    `api=${aLib.length} ui=${aUiLib} "${aHdr2}"`);

  const aWord = abstractOnlyWord(aLand);
  if (aWord) {
    const aExpected = aLand.nodes.filter((n) => kwMatch(n, aWord[0])).length;
    await goView(page, 'list');
    await page.type('input[data-testid="landscape-filter-keyword"]', aWord[0]);
    await sleep(500);
    const aSumm = await labelText(page, 'landscape-filter-summary');
    await goView(page, 'graph');
    await sleep(300);
    const aG = await countsText(page);
    step('A14. a keyword narrows EVERY view: "x of N papers" + graph node count follow',
      aSumm === `${aExpected} of ${aLand.nodes.length} papers`
        && aG && aG.nodes === aExpected, `${aSumm} graph=${JSON.stringify(aG)}`);
    await resetFilters(page);
    await sleep(300);
    const aG2 = await countsText(page);
    step('A15. [Clear filters] restores the full landscape in every view',
      aG2 && aG2.nodes === aLand.nodes.length
        && (await labelText(page, 'landscape-filter-summary'))
          === `${aLand.nodes.length} of ${aLand.nodes.length} papers`,
      JSON.stringify(aG2));
  } else {
    step('A14. a keyword narrows EVERY view: "x of N papers" + graph node count follow',
      false, 'no abstract-only word available');
    step('A15. [Clear filters] restores the full landscape in every view',
      false, 'no abstract-only word available');
  }

  await goView(page, 'list');
  await setSelectBy(page, 'select[data-testid="landscape-sort-by"]', 'title');
  await sleep(400);
  const aIds = await rowIds(page);
  const aTitles = aIds.map((id) => (aLand.nodes.find((n) => n.id === id) || {}).title || '');
  const aSorted = [...aTitles].sort((x, y) => x.localeCompare(y));
  step('A16. Sort By Title orders A → Z',
    aTitles.length === aLand.nodes.length && JSON.stringify(aTitles) === JSON.stringify(aSorted),
    aTitles[0]);

  const aYearOpts = await page.evaluate(() => Array.from(
    document.querySelector('select[data-testid="landscape-filter-year-from"]').options)
    .map((o) => o.value));
  step('A17. year options include the CURRENT year (dynamic, never hard-coded)',
    aYearOpts.includes(String(CURRENT_YEAR)), `opts=[${aYearOpts.join(',')}]`);

  await clickText(page, 'button', 'Library');
  await sleep(700);
  // Remove membership of whichever member is open — seed is always one.
  let removeReady = await pollUntil(page,
    () => Boolean(document.querySelector('[data-testid="library-remove"]')), null, 4000);
  let removedId = aDisc0.id;
  if (!removeReady) {
    const seedTitle = (aLand.nodes.find((n) => n.id === aSeed) || {}).title || '';
    await clickText(page, 'button', seedTitle.slice(0, 40));
    removeReady = await pollUntil(page,
      () => Boolean(document.querySelector('[data-testid="library-remove"]')), null, 8000);
    removedId = aSeed;
  }
  if (removeReady) await clickSel(page, '[data-testid="library-remove"]');
  const aLibMinus = await pollApiUntil(async () => {
    const ps = await api(`/api/projects/${A.id}/papers`);
    return ps.length === aLib.length - 1 ? ps : null;
  }, 15000, 300);
  // The Library list refreshes on its own (2s poll + membership callback);
  // poll the count element rather than racing one read against React.
  await pollUntil(page, (n) => {
    for (const el of document.querySelectorAll('div,span,p')) {
      const m = (el.textContent || '').trim().match(/^(\d+) papers?$/);
      if (m && Number(m[1]) === n) return true;
    }
    return false;
  }, aLib.length - 1, 10000);
  const aUiAfterRemove = await paperCount(page);
  const aLandAfter = await api(`/api/landscape/${A.id}`);
  const aNodeAlive = aLandAfter.nodes.length === aLand.nodes.length
    && aLandAfter.nodes.some((n) => n.id === removedId);
  step('A18. remove membership: leaves Library, the Landscape node is NEVER destroyed',
    removeReady && Boolean(aLibMinus) && aUiAfterRemove === aLib.length - 1 && aNodeAlive,
    `ready=${removeReady} api=${aLibMinus ? aLibMinus.length : 'null'}/${aLib.length} `
    + `ui=${aUiAfterRemove}/${aLib.length - 1} nodes=${aLandAfter.nodes.length} removed=${removedId}`);

  await ensureLandscape(page);
  await page.reload({ waitUntil: 'networkidle2' });
  // The active project is not persisted across reload — the app comes up
  // on the FIRST project. Re-select the acceptance project before
  // asserting its header against its own API truth.
  await ensureActiveProject(page, A.name);
  await ensureLandscape(page);
  const aLandFinal = await api(`/api/landscape/${A.id}`);
  const aMFinal = aLandFinal.nodes.filter((n) => n.in_project).length;
  const aHdrExpected = `Landscape ${aLandFinal.nodes.length} · In project ${aMFinal} · Discovered ${aLandFinal.nodes.length - aMFinal}`;
  // The header must CONVERGE on the API truth (membership changed in
  // another view) — poll instead of a single raced read.
  await pollUntil(page, (h) => {
    const el = document.querySelector('[data-testid="landscape-counts"]');
    return Boolean(el) && (el.textContent || '').trim() === h;
  }, aHdrExpected, 10000);
  const aHdrFinal = await labelText(page, 'landscape-counts');
  const aListVisible = await count(page, '[data-testid="landscape-list"]');
  const aView = await page.evaluate(() => localStorage.getItem('liit.landscape.view'));
  step('A19. after reload: view persisted, header consistent with API, zero page errors',
    aView === 'list'
      && aListVisible === 1
      && aHdrFinal === aHdrExpected
      && pageErrors.length === 0,
    `view=${aView} list=${aListVisible} hdr="${aHdrFinal}" `
    + `api="${aHdrExpected}" errors=${pageErrors.length}`);

  await shot(page, 'final');
  await browser.close();

  console.log(`\n${failures === 0
    ? 'ALL 37 CHECKS + 19 ACCEPTANCE STEPS PASSED'
    : `FAILURES: ${failures}`}`);
  if (pageErrors.length) console.log(`page errors: ${JSON.stringify(pageErrors.slice(0, 5))}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
