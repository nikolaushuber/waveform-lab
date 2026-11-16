// Loads the unmodified, monolithic script.js into the Vitest jsdom
// environment and hands back every top-level function it defines.
//
// script.js is one `(() => { ... })();` with no exports, so we strip the
// wrapper, evaluate the body inside a new Function and append a `return`
// listing all top-level function names. Startup code at the bottom of
// script.js runs as usual against the DOM from index.html, with the few
// browser APIs jsdom lacks (canvas, Web Audio, IndexedDB) stubbed out.
//
// Temporary: in the module split, each test switches to importing from
// src/ directly and this file is deleted.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..') + '/';

function fakeContext2d() {
  const noop = () => fakeObject;
  const fakeObject = new Proxy(noop, {
    get: (_t, prop) => {
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return fakeObject;
    },
    set: () => true,
    apply: () => fakeObject,
  });
  return fakeObject;
}

function installBrowserStubs(win) {
  win.HTMLCanvasElement.prototype.getContext = () => fakeContext2d();
  class FakeAudioContext {
    constructor() { this.sampleRate = 44100; this.state = 'running'; }
    decodeAudioData() { return Promise.reject(new Error('decodeAudioData is not available in tests')); }
    close() { return Promise.resolve(); }
  }
  win.AudioContext = FakeAudioContext;
  win.webkitAudioContext = FakeAudioContext;
  // No IndexedDB: openDB() rejects and restoreLibraries() logs a warning.
  win.indexedDB = undefined;
  win.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 16);
  win.cancelAnimationFrame ??= (id) => clearTimeout(id);
}

let cached = null;

export function loadLegacy() {
  if (cached) return cached;

  const html = readFileSync(root + 'index.html', 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = body;
  installBrowserStubs(window);

  const src = readFileSync(root + 'script.js', 'utf8');
  const start = src.indexOf('(() => {');
  const end = src.lastIndexOf('})();');
  if (start !== 0 || end < 0) throw new Error('script.js no longer has the expected IIFE wrapper');
  const inner = src.slice('(() => {'.length, end);

  const names = [...inner.matchAll(/^ {2}(?:async )?function (\w+)\s*\(/gm)].map((m) => m[1]);
  const fn = new Function(`${inner}\nreturn { ${names.join(', ')} };`);

  // Startup (restoreLibraries) warns asynchronously that there is no
  // IndexedDB; drop just those expected messages.
  const warn = console.warn;
  console.warn = (msg, ...rest) => {
    if (typeof msg === 'string' && /^Could not (read from local storage|restore local file folder)/.test(msg)) return;
    warn(msg, ...rest);
  };
  cached = fn();
  return cached;
}
