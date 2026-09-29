// LiiT interactive smoke test: drives the real app in headless Chrome.
// Fails on any page error or failed assertion. Screenshots to /tmp.
// Uses the isolated smoke backend (:8001) + frontend (:8444).
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:8444/';
const errors = [];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function textClick(page, tag, text) {
  const found = await page.evaluate((t, s) => {
    const els = Array.from(document.querySelectorAll(t));
    const el = els.find(e => (e.textContent || '').trim().startsWith(s));
    if (el) { el.scrollIntoView(); (el).click(); return true; }
    return false;
  }, tag, text);
  if (!found) throw new Error(`click target missing: <${tag}> "${text}"`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('response', r => {
    // Expected empty-state 404s (handled in UI) are not failures.
    if (r.status() >= 400 && !r.url().includes('/synthesis')) {
      errors.push(`http ${r.status()}: ${r.url()}`);
    }
  });
  page.on('console', m => {
    // Network failures surface precisely via the response listener;
    // console's copy carries no URL, so ignore it here to avoid noise.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      errors.push(`console: ${m.text()}`);
    }
  });

  // 1. LiiT opens, project + library load with real papers
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(
    () => document.body.textContent.includes('Voltage imaging of CA1'),
    { timeout: 20000 });
  const title = await page.title();
  if (title !== 'LiiT') throw new Error(`bad title: ${title}`);
  await page.screenshot({ path: '/tmp/liit_1_library.png' });

  // 2. Open paper detail
  await textClick(page, 'button', 'Voltage imaging of CA1');
  await page.waitForFunction(
    () => document.body.textContent.includes('Abstract'),
    { timeout: 20000 });
  await sleep(1500);
  await page.screenshot({ path: '/tmp/liit_2_paper.png' });

  // 3. Searches view: run a live arXiv search (fast, small)
  await textClick(page, 'button', 'Searches');
  await page.waitForFunction(
    () => document.body.textContent.includes('Search literature'),
    { timeout: 10000 });
  await page.screenshot({ path: '/tmp/liit_3_search_empty.png' });
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('no query box');
    ta.focus();
    document.execCommand('selectAll', false, undefined);
    document.execCommand('insertText', false, 'quantum error correction surface codes');
  });
  // switch to arXiv tab
  await textClick(page, 'button', 'arXiv');
  await textClick(page, 'button', 'Run search');
  await page.waitForFunction(
    () => document.body.textContent.includes('results for'),
    { timeout: 60000 });
  await sleep(1000);
  await page.screenshot({ path: '/tmp/liit_4_search_results.png' });

  // 4. Import first result explicitly
  await textClick(page, 'button', '+ Import');
  await page.waitForFunction(
    () => document.body.textContent.includes('In library'),
    { timeout: 60000 });
  await sleep(500);
  await page.screenshot({ path: '/tmp/liit_5_imported.png' });

  // 5. Library shows the new paper; open it
  await textClick(page, 'button', 'Library');
  await page.waitForFunction(
    () => (document.body.textContent.match(/metadata-only/g) || []).length >= 3,
    { timeout: 20000 });
  await page.screenshot({ path: '/tmp/liit_6_library3.png' });

  // 6. Landscape renders nodes + edges, select a node
  await textClick(page, 'button', 'Landscape');
  await page.waitForFunction(
    () => document.querySelectorAll('.graph-node').length >= 3,
    { timeout: 20000 });
  const nodeCount = await page.evaluate(
    () => document.querySelectorAll('.graph-node').length);
  const edgeCount = await page.evaluate(
    () => document.querySelectorAll('line').length);
  console.log(`NODES=${nodeCount} EDGES=${edgeCount}`);
  await page.evaluate(() => {
    const n = document.querySelector('.graph-node');
    if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(800);
  const detail = await page.evaluate(
    () => document.body.textContent.includes('Selected paper') ? 'ok' : 'missing');
  if (detail !== 'ok') throw new Error('node detail panel missing');
  await page.screenshot({ path: '/tmp/liit_7_landscape.png' });

  // 7. Projects view
  await textClick(page, 'button', 'Projects');
  await page.waitForFunction(
    () => document.body.textContent.includes('Place cells'),
    { timeout: 10000 });
  await page.screenshot({ path: '/tmp/liit_8_projects.png' });

  await browser.close();
  if (errors.length) {
    console.log('JS ERRORS:');
    errors.forEach(e => console.log(' ', e.slice(0, 300)));
    process.exit(1);
  }
  console.log('SMOKE OK, no JS errors');
}

main().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
