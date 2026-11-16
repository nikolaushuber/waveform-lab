// Prepares the Vitest jsdom environment for importing UI modules: the
// index.html body (so DOM lookups at import time succeed) plus stubs for the
// browser APIs jsdom lacks (canvas 2D, Web Audio, IndexedDB).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fakeContext2d() {
  const noop = () => fake;
  const fake = new Proxy(noop, {
    get: (_t, prop) => {
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return fake;
    },
    set: () => true,
    apply: () => fake,
  });
  return fake;
}

export function installAppDom() {
  const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  window.HTMLCanvasElement.prototype.getContext = () => fakeContext2d();
  class FakeAudioContext {
    decodeAudioData() { return Promise.reject(new Error('decodeAudioData is not available in tests')); }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = FakeAudioContext;
  window.indexedDB = undefined;
}
