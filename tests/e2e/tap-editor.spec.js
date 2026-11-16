import { test, expect } from '@playwright/test';
import { openApp, gotoTab, wavFile } from './helpers.js';
import { SR, recordings } from '../helpers/fixtures.js';

// a1.wav: 5 s, taps at 0.6, 1.4, 2.3, 3.1, 4.0 s. Auto Crop Start lands
// between the first two, so detection starts with 4 taps.
const A1 = recordings[0];
const DUR = A1.samples.length / SR;

async function editor(page) {
  const canvas = page.locator('#tapEditorCanvas');
  const box = await canvas.boundingBox();
  return {
    canvas,
    at: (t, y = 0.5) => ({ x: box.x + (t / DUR) * box.width, y: box.y + box.height * y }),
    count: async () => Number(await canvas.getAttribute('data-tap-count')),
    cropStart: async () => Number(await canvas.getAttribute('data-crop-start')),
  };
}

async function waitDetected(page) {
  await expect(page.locator('#tapEditorSummary')).not.toContainText('detecting', { timeout: 120_000 });
}

test('tap editor: drag the crop, add/remove taps, analyse exactly what is shown', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);

  const ed = await editor(page);
  const summary = page.locator('#tapEditorSummary');
  await expect(summary).toContainText('Crop start: auto →');
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '4');

  // Drag the auto crop edge back to the start: the crop becomes manual,
  // the row input follows and detection finds the first tap too.
  const from = ed.at(await ed.cropStart());
  const to = ed.at(0.05);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#tapCropStart')).toHaveValue('0.05');
  await expect(page.locator('#tapRows .tr-meta')).toContainText('crop 0.05 s');
  await expect(summary).toContainText('Crop start: 0.05 s');
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '5', { timeout: 60_000 });

  // Double-click empty space adds a tap; right-click removes it again.
  const added = ed.at(4.6);
  await page.mouse.dblclick(added.x, added.y);
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '6');
  await expect(summary).toContainText('(edited)');
  await page.mouse.click(added.x, added.y, { button: 'right' });
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '5');

  // Remove one more and analyse: the analysis uses exactly the taps shown.
  const second = ed.at(1.4);
  await page.mouse.click(second.x, second.y, { button: 'right' });
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '4');
  await page.locator('#runTapBtn').click();
  await expect(page.locator('#tapStatus')).toContainText('Done', { timeout: 120_000 });
  await expect(page.locator('#tapResultsBody')).toContainText('a1.wav — 4 of 4 events analysed');

  // Reset taps goes back to detection.
  await page.locator('#tapEditorResetTaps').click();
  await waitDetected(page);
  await expect(summary).not.toContainText('(edited)');
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '5');
  expect(errors).toEqual([]);
});

test('tap editor: typed crop, click-to-seek and playback', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);
  await expect(page.locator('#tapRows canvas')).toHaveCount(0); // no more row thumbnails
  const ed = await editor(page);

  // Typing a crop in the panel behaves like dragging the edge.
  await page.locator('#tapCropStart').fill('2');
  await page.locator('#tapCropStart').press('Enter');
  await expect(ed.canvas).toHaveAttribute('data-crop-start', '2.000');
  await expect(page.locator('#tapEditorSummary')).toContainText('Crop start: 2.00 s');
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '3', { timeout: 60_000 });
  await page.locator('#tapEditorResetCrop').click();
  await expect(page.locator('#tapCropStart')).toHaveValue('');

  // Clicking empty space moves the playhead; play advances it, pause stops it.
  await expect(page.locator('#tapDurTime')).toHaveText('0:05.000');
  const spot = ed.at(2.0, 0.8);
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('#tapCurTime')).toHaveText(/^0:0(1\.9|2\.0)/);
  await page.locator('#tapPlayBtn').click();
  await expect.poll(async () => parseFloat((await page.locator('#tapCurTime').innerText()).split(':')[1])).toBeGreaterThan(2.2);
  await page.locator('#tapPlayBtn').click();
  const paused = await page.locator('#tapCurTime').innerText();
  await page.waitForTimeout(300);
  await expect(page.locator('#tapCurTime')).toHaveText(paused);
  expect(errors).toEqual([]);
});

test('tap editor: hand-edited taps are saved with File Folder files', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  const loadFromFolder = async () => {
    await gotoTab(page, 'tap');
    await page.locator('#loadFromFolderBtnTap').click();
    await page.locator('.folder-pick-row', { hasText: 'kept.wav' }).locator('input[type="checkbox"]').check();
    await page.locator('.modal-footer button', { hasText: 'Add selected' }).click();
    await waitDetected(page);
  };

  await gotoTab(page, 'folder');
  await page.locator('#fileInputFolder').setInputFiles(wavFile('kept.wav', A1.samples));
  await expect(page.locator('#folderFileCount')).toContainText('1');
  await loadFromFolder();

  const ed = await editor(page);
  const added = ed.at(4.6);
  await page.mouse.dblclick(added.x, added.y);
  await expect(ed.canvas).toHaveAttribute('data-tap-count', '5');

  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('waveform-lab-db');
    req.onsuccess = () => {
      const all = req.result.transaction('fileFolder').objectStore('fileFolder').getAll();
      all.onsuccess = () => resolve(all.result.map((r) => (r.taps || []).length));
    };
  }))).toEqual([5]);

  await page.reload();
  await loadFromFolder();
  await expect(page.locator('#tapEditorSummary')).toContainText('5 taps (edited)');
  expect(errors).toEqual([]);
});
