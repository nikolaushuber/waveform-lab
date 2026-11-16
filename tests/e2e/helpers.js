import { expect } from '@playwright/test';
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

// Opens the app and fails the test on any uncaught error or console.error.
export async function openApp(page) {
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
