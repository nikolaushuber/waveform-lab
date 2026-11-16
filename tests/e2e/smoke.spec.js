import { test, expect } from '@playwright/test';
import { openApp, gotoTab, fixtureFiles, earlyTapFile, wavFile } from './helpers.js';
import { SR, recordings } from '../helpers/fixtures.js';

test('home: every tab opens and the page loads without errors', async ({ page }) => {
  const errors = await openApp(page);
  for (const name of ['analyze', 'compare', 'tap', 'cluster', 'folder', 'home']) await gotoTab(page, name);
  // Home cards navigate too.
  await page.locator('.home-card[data-goto="tap"]').click();
  await expect(page.locator('#page-tap')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('waveform: load a file and capture a snapshot with Sample', async ({ page }) => {
  const errors = await openApp(page);
  await gotoTab(page, 'analyze');
  await page.locator('#fileInput').setInputFiles(earlyTapFile());
  await expect(page.locator('#fileCount')).toHaveText('1 loaded');
  await expect(page.locator('#nowPlayingLabel')).toContainText('early.wav');
  await expect(page.locator('#durTime')).toHaveText('0:02.000');

  await expect(page.locator('#sampleBtn')).toBeEnabled();
  await page.locator('#sampleBtn').click();
  const peak = page.locator('.stat', { hasText: 'Peak Frequency' }).locator('.v');
  await expect(peak).toHaveText(/^19\d\.\d Hz$/); // the planted 196 Hz partial
  await expect(page.locator('#exportBtn')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('compare: two snapshots give two traces', async ({ page }) => {
  const errors = await openApp(page);
  await gotoTab(page, 'compare');
  await page.locator('#fileInputCompare').setInputFiles([earlyTapFile('x.wav'), earlyTapFile('y.wav')]);
  await expect(page.locator('#compareFileCount')).toHaveText('2 loaded');
  const adds = page.locator('.cr-add');
  await adds.nth(0).click();
  await adds.nth(1).click();
  await expect(page.locator('#compareLegend')).toContainText('x.wav');
  await expect(page.locator('#compareLegend')).toContainText('y.wav');
  expect(errors).toEqual([]);
});

test('tap analyser: run analysis on the fixture recordings', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(fixtureFiles());
  await expect(page.locator('#tapFileCount')).toContainText(`${recordings.length} loaded`);
  await page.locator('#runTapBtn').click();
  // First run includes loading Pyodide in the worker.
  await expect(page.locator('#tapStatus')).toContainText('Done', { timeout: 120_000 });
  const results = page.locator('#tapResultsBody');
  await expect(results.locator('.variance-block')).toHaveCount(recordings.length);
  // Planted partials show up (browser resamples to the device rate, so allow ±2 Hz).
  const text = await results.innerText();
  for (const f of [196, 523, 311, 740]) {
    expect(text).toMatch(new RegExp(`\\b(${f - 2}|${f - 1}|${f}|${f + 1}|${f + 2})\\.\\d Hz`));
  }
  expect(errors).toEqual([]);
});

test('clustering: separates the two materials', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'cluster');
  await page.locator('#fileInputCluster').setInputFiles(fixtureFiles());
  await expect(page.locator('#clusterFileCount')).toContainText(`${recordings.length} loaded`);
  await page.locator('#runClusterBtn').click();
  await expect(page.locator('#clusterStatus')).toContainText('Done', { timeout: 120_000 });
  const results = page.locator('#clusterResultsBody');
  await expect(results).toContainText('Chosen k = 2');
  await expect(results).toContainText('Per-file cluster breakdown');
  for (const r of recordings) await expect(results).toContainText(r.name);
  expect(errors).toEqual([]);
});

test('file folder: crop settings persist across reloads and load into the Tap Analyser', async ({ page }) => {
  const errors = await openApp(page);
  await gotoTab(page, 'folder');
  await page.locator('#fileInputFolder').setInputFiles(wavFile('kept.wav', recordings[0].samples, SR));
  await expect(page.locator('#folderFileCount')).toContainText('1');

  const row = page.locator('#folderRows .tap-row', { hasText: 'kept.wav' });
  await row.locator('.tr-name').click();
  const cropStart = row.locator('.tr-fields input[type="number"]').first();
  await cropStart.fill('0.4');
  await cropStart.dispatchEvent('change');

  // Wait until the value has been written to IndexedDB.
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('waveform-lab-db');
    req.onsuccess = () => {
      const all = req.result.transaction('fileFolder').objectStore('fileFolder').getAll();
      all.onsuccess = () => resolve(all.result.map((r) => r.skipStart));
    };
  }))).toEqual(['0.4']);

  await page.reload();
  await gotoTab(page, 'folder');
  const rowAfter = page.locator('#folderRows .tap-row', { hasText: 'kept.wav' });
  await rowAfter.locator('.tr-name').click();
  await expect(rowAfter.locator('.tr-fields input[type="number"]').first()).toHaveValue('0.4');

  await gotoTab(page, 'tap');
  await page.locator('#loadFromFolderBtnTap').click();
  await page.locator('.folder-pick-row', { hasText: 'kept.wav' }).locator('input[type="checkbox"]').check();
  await page.locator('.modal-footer button', { hasText: 'Add selected' }).click();
  await expect(page.locator('#tapFileCount')).toContainText('1 loaded');
  await expect(page.locator('#tapRows .tr-fields input[type="number"]').first()).toHaveValue('0.4');
  expect(errors).toEqual([]);
});
