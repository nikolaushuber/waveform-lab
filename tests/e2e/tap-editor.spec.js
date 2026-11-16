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
  const view = async () => [Number(await canvas.getAttribute('data-view-start')), Number(await canvas.getAttribute('data-view-end'))];
  return {
    canvas,
    view,
    box,
    // Page position of time t in the currently visible window.
    atView: async (t, y = 0.5) => { const [a, b] = await view(); return { x: box.x + ((t - a) / (b - a)) * box.width, y: box.y + box.height * y }; },
    at: (t, y = 0.5) => ({ x: box.x + (t / DUR) * box.width, y: box.y + box.height * y }),
    count: async () => Number(await canvas.getAttribute('data-tap-count')),
    cropStart: async () => Number(await canvas.getAttribute('data-crop-start')),
  };
}

// Waits until a file is shown AND its detection has finished. (Checking only
// for "detecting" to disappear passed too early, while the summary still
// said "Load a recording…" — and on a cold CI runner Pyodide takes a while.)
async function waitDetected(page) {
  const summary = page.locator('#tapEditorSummary');
  await expect(summary).toContainText('Crop start', { timeout: 60_000 });
  await expect(summary).not.toContainText('detecting', { timeout: 120_000 });
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

  // A click on the crop edge without moving it is not an edit.
  const edgeAt = ed.at(await ed.cropStart());
  await page.mouse.click(edgeAt.x, edgeAt.y);
  await expect(summary).toContainText('Crop start: auto →');

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
  // The waveform is scaled so the loudest sample inside the crop fills the
  // height (a1 peaks around 0.7, so it's drawn ~1.4x larger).
  const gain = Number(await ed.canvas.getAttribute('data-gain'));
  expect(gain).toBeGreaterThan(1.2);
  expect(gain).toBeLessThan(2);

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

test('tap editor: zoom, pan and edit while zoomed', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);
  const ed = await editor(page);
  const label = page.locator('#tapZoomLabel');
  await expect(label).toHaveText('whole recording');

  // Buttons zoom around the playhead while it's visible (at 0 before playback).
  await page.locator('#tapZoomIn').click();
  await page.locator('#tapZoomIn').click();
  let [a, b] = await ed.view();
  expect(b - a).toBeCloseTo(DUR / 4, 3);
  expect(a).toBe(0);
  // Moving the playhead moves the zoom anchor with it.
  const mid = await ed.atView(0.3, 0.85);
  await page.mouse.click(mid.x, mid.y); // playhead to 0.3 s, 24% across [0, 1.25]
  await expect(page.locator('#tapCurTime')).toHaveText(/^0:00\.(29|30)/);
  await page.locator('#tapZoomIn').click();
  [a, b] = await ed.view();
  expect(b - a).toBeCloseTo(DUR / 8, 3);
  expect((0.3 - a) / (b - a)).toBeCloseTo(0.24, 1); // ...and it stays 24% across
  await expect(label).toContainText('×8.0');
  await page.locator('#tapZoomFit').click();
  await expect(label).toHaveText('whole recording');

  // Ctrl + wheel zooms around the cursor: the time under it stays put.
  const p = ed.at(1.4);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -600);
  await page.keyboard.up('Control');
  [a, b] = await ed.view();
  expect(b - a).toBeLessThan(DUR / 2);
  expect(a + ((p.x - ed.box.x) / ed.box.width) * (b - a)).toBeCloseTo(1.4, 2);

  // Dragging on the overview strip pans without changing the zoom.
  const span = b - a;
  const ov = await page.locator('#tapEditorOverview').boundingBox();
  const from = { x: ov.x + ((a + b) / 2 / DUR) * ov.width, y: ov.y + ov.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + ov.width * 0.3, from.y, { steps: 6 });
  await page.mouse.up();
  const [a2, b2] = await ed.view();
  expect(b2 - a2).toBeCloseTo(span, 3);
  expect(a2).toBeGreaterThan(a + 1);

  // Edit while zoomed: add a tap at 4.6 s and remove it again.
  await page.locator('#tapZoomCrop').click();
  await page.locator('#tapZoomIn').click();
  const before = await ed.count();
  const [c0, c1] = await ed.view();
  const t = (c0 + c1) / 2;
  const spot = await ed.atView(t, 0.6);
  await page.mouse.dblclick(spot.x, spot.y);
  await expect(ed.canvas).toHaveAttribute('data-tap-count', String(before + 1));
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(ed.canvas).toHaveAttribute('data-tap-count', String(before));

  // While playing, the view follows the playhead off the right edge.
  await page.locator('#tapZoomFit').click();
  for (let i = 0; i < 4; i++) await page.locator('#tapZoomIn').click(); // ×16 around the playhead: ~0.31 s wide
  const [v0, v1] = await ed.view();
  const left = await ed.atView(v0 + 0.01, 0.85);
  await page.mouse.click(left.x, left.y); // playhead near the left edge
  await page.locator('#tapPlayBtn').click();
  await expect.poll(async () => (await ed.view())[0], { timeout: 5000 }).toBeGreaterThan(v1 - 0.05);
  await page.locator('#tapPlayBtn').click();
  expect(errors).toEqual([]);
});

test('tap editor: taps are blocks with header bars in lanes', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);
  const ed = await editor(page);
  const taps = async () => (await ed.canvas.getAttribute('data-taps')).split(',').map(Number);

  // a1's taps are 0.8-0.9 s apart, closer than a window (1.1 s), so
  // consecutive header bars alternate between lane 0 and lane 1.
  const before = await taps();
  expect(before).toHaveLength(4);
  const headerY = (lane) => ed.box.y + (4 + lane * 18 + 8) * (ed.box.height / 180);

  // Drag tap 2's header bar (lane 1) 0.2 s to the right, Alt = no snapping:
  // the tap moves by exactly the drag distance, wherever the bar was grabbed.
  const t = before[1];
  const grabT = t + 0.5;
  const from = { x: ed.at(grabT).x, y: headerY(1) };
  const to = { x: ed.at(grabT + 0.2).x, y: headerY(1) };
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await taps())[1]).toBeCloseTo(t + 0.2, 1);
  await expect(page.locator('#tapEditorSummary')).toContainText('(edited)');

  // Right-click on a header bar removes that tap.
  const third = (await taps())[2];
  await page.mouse.click(ed.at(third + 0.6).x, headerY(0), { button: 'right' });
  await expect.poll(async () => (await taps()).length).toBe(3);
  expect((await taps()).some((x) => Math.abs(x - third) < 1e-3)).toBe(false);
  expect(errors).toEqual([]);
});

test('tap editor: dragged taps snap to a nearby attack, and stay put elsewhere', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);
  const ed = await editor(page);
  const taps = async () => (await ed.canvas.getAttribute('data-taps')).split(',').map(Number);
  const [t1, t2, t3] = await taps(); // ~1.4, 2.3, 3.1 (4.0 is the 4th)

  // Remove the tap at ~3.1 s, then drag the ~2.3 s tap by its attack line
  // to 30 ms past the 3.1 s attack: it snaps exactly onto that attack.
  await page.mouse.click(ed.at(t3).x, ed.at(t3, 0.6).y, { button: 'right' });
  await expect.poll(async () => (await taps()).length).toBe(3);
  const drag = async (from, to) => {
    await page.mouse.move(ed.at(from).x, ed.at(from, 0.6).y);
    await page.mouse.down();
    await page.mouse.move(ed.at(to).x, ed.at(to, 0.6).y, { steps: 8 });
    await page.mouse.up();
  };
  await drag(t2, t3 + 0.03);
  await expect.poll(async () => (await taps())[1]).toBeCloseTo(t3, 3);

  // Dragged into a quiet stretch it lands exactly where it was dropped.
  await drag(t3, 4.6);
  await expect.poll(async () => Math.min(...(await taps()).map((x) => Math.abs(x - 4.6)))).toBeLessThan(0.02);
  expect((await taps()).some((x) => Math.abs(x - t3) < 1e-3)).toBe(false); // moved away from 3.1
  expect((await taps())[0]).toBeCloseTo(t1, 3);
  expect(errors).toEqual([]);
});

test('tap editor: Window start is a setting used by the editor and the analysis', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openApp(page);
  await gotoTab(page, 'tap');
  await page.locator('#fileInputTap').setInputFiles(wavFile('a1.wav', A1.samples));
  await waitDetected(page);
  const ed = await editor(page);
  await expect(page.locator('#tapWindowOffset')).toHaveValue('0.1');
  await expect(ed.canvas).toHaveAttribute('data-window-offset', '0.1');

  const run = async () => {
    await page.locator('#runTapBtn').click();
    await expect(page.locator('#tapStatus')).toContainText('Done', { timeout: 120_000 });
    return page.locator('#tapResultsBody').innerText();
  };
  const before = await run();

  // Start the window 10 ms before the attack, so it encloses the tap.
  await page.locator('#tapWindowOffset').fill('-0.01');
  await page.locator('#tapWindowOffset').press('Enter');
  await expect(ed.canvas).toHaveAttribute('data-window-offset', '-0.01');
  const after = await run();
  expect(after).toContain('4 of 4 events analysed');
  expect(after).not.toEqual(before);

  // Nonsense input falls back to the default.
  await page.locator('#tapWindowOffset').fill('');
  await page.locator('#tapWindowOffset').press('Enter');
  await expect(page.locator('#tapWindowOffset')).toHaveValue('0.1');
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
