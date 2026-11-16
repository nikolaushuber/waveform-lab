import { el } from './dom.js';

// ---------------- Resizable side panels ----------------
// Drag the thin divider between the library panel and the workspace to
// widen the sidebar — handy when a filename is too long to read in the
// default width. Each page remembers its own width independently (set as
// a --lib-w custom property scoped to that page's own .grid element), and
// the responsive collapse-to-single-column breakpoints are untouched since
// they set grid-template-columns directly, bypassing the variable.
export function makeResizable(handleEl, minPx, maxPx){
  if (!handleEl) return;
  const gridEl = handleEl.parentElement;
  const leftPanel = handleEl.previousElementSibling;
  if (!gridEl || !leftPanel) return;
  let dragging = false, startX = 0, startW = 0;
  handleEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = leftPanel.getBoundingClientRect().width;
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const newW = Math.min(maxPx, Math.max(minPx, startW + (e.clientX - startX)));
    gridEl.style.setProperty('--lib-w', newW + 'px');
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
    document.body.classList.remove('resizing');
  });
}

// Wiring that ran at load time in the original script.js; main.js calls
// each module's init() in the original order.
export function init(){
  makeResizable(el('resizeAnalyze'), 200, 640);
  makeResizable(el('resizeCompare'), 260, 720);
  makeResizable(el('resizeTap'), 200, 640);
  makeResizable(el('resizeCluster'), 300, 760);
}
