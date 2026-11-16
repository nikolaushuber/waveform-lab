import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { encodeWav } from '../helpers/wav.js';
import { SR, recordings } from '../helpers/fixtures.js';
import { tapRecording } from '../helpers/signals.js';

export function wavFile(name, samples, sr = SR) {
  return { name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWav(samples, sr)) };
}

export const fixtureFiles = () => recordings.map((r) => wavFile(r.name, r.samples));

// A recording whose first tap is within the Sample button's 0.5 s search window.
export const earlyTapFile = (name = 'early.wav') =>
  wavFile(name, tapRecording({ sr: SR, duration: 2, onsets: [0.2, 1.0], partials: [{ freq: 196, amp: 1 }, { freq: 523, amp: 0.4 }] }));

// Every test gets a fresh browser profile, so without this each one would
// download Pyodide (~40 MB) from the CDN. Responses are kept on disk instead.
const PYODIDE_CACHE = resolve('node_modules/.cache/pyodide-e2e');

async function cachePyodide(context) {
  mkdirSync(PYODIDE_CACHE, { recursive: true });
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\//, async (route) => {
    const key = join(PYODIDE_CACHE, createHash('sha1').update(route.request().url()).digest('hex'));
    try {
      if (existsSync(key)) {
        const { contentType } = JSON.parse(readFileSync(key + '.json', 'utf8'));
        return await route.fulfill({ status: 200, contentType, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(key) });
      }
      const response = await route.fetch();
      const body = await response.body();
      if (response.ok()) {
        // Metadata first, then the body via rename: a parallel test never
        // sees a half-written file.
        writeFileSync(key + '.json', JSON.stringify({ contentType: response.headers()['content-type'] }));
        const tmp = `${key}.${process.pid}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, key);
      }
      await route.fulfill({ response, body });
    } catch (err) {
      // The page starts loading Pyodide on open, so short tests often end
      // mid-download; nothing is waiting for the response any more.
      if (!/Test ended|closed/i.test(String(err?.message))) throw err;
    }
  });
}

// Opens the app and fails the test on any uncaught error or console.error.
export async function openApp(page) {
  await cachePyodide(page.context());
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/');
  await expect(page.locator('#page-home')).toHaveClass(/active/);
  return errors;
}

export async function gotoTab(page, name) {
  await page.locator(`.tab-btn[data-page="${name}"]`).click();
  await expect(page.locator(`#page-${name}`)).toHaveClass(/active/);
}
