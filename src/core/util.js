// Yields to the event loop, so long analyses keep the page responsive.
export function sleep0(){ return new Promise(r => setTimeout(r, 0)); }
