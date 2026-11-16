import { el } from './dom.js';
import { drawCompareGraph } from './pages/compare.js';


// Wiring that ran at load time in the original script.js; main.js calls
// each module's init() in the original order.
export function init(){
  document.querySelectorAll('.home-card').forEach(card => {
    card.addEventListener('click', () => {
      const btn = document.querySelector(`.tab-btn[data-page="${card.dataset.goto}"]`);
      if (btn) btn.click();
    });
  });

  // ---------------- Tab navigation ----------------
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      el('page-' + btn.dataset.page).classList.add('active');
      if (btn.dataset.page === 'compare'){
        drawCompareGraph();
      }
    });
  });
}
