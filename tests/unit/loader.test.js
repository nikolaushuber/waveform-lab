import { describe, it, expect } from 'vitest';
import { loadLegacy } from '../helpers/load-legacy.js';

describe('legacy loader', () => {
  it('exposes the top-level functions of script.js', () => {
    const wl = loadLegacy();
    for (const name of ['fftInPlace', 'bluesteinDFT', 'detectTapEvents', 'rfProximityClustering', 'renderFolderRows']) {
      expect(typeof wl[name]).toBe('function');
    }
  });
});
