// Animação do sorteio: os nomes da lista de presença são embaralhados na tela por 5 segundos.
import { html, ic, $ } from '../../ui/dom.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/** Mostra o embaralhamento e resolve ao terminar (ou ao tocar em "Pular"). */
export function playShuffle(names, { ms = 5000, title = 'Sorteando os times…' } = {}) {
  let cancel = () => {};
  const promise = new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'shuffle';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Sorteio dos times em andamento');
    const chips = names.map((n, i) => {
      const v = { x1: rnd(-42, 42), y1: rnd(-30, 30), x2: rnd(-42, 42), y2: rnd(-30, 30), x3: rnd(-42, 42), y3: rnd(-30, 30), r1: rnd(-18, 18), r2: rnd(-18, 18), r3: rnd(-18, 18), d: -rnd(0, 1.4), t: rnd(1.0, 1.5), h: (i * 47) % 360 };
      return html`<span class="shuffle-chip" style="--x1:${v.x1.toFixed(1)}vw;--y1:${v.y1.toFixed(1)}vh;--x2:${v.x2.toFixed(1)}vw;--y2:${v.y2.toFixed(1)}vh;--x3:${v.x3.toFixed(1)}vw;--y3:${v.y3.toFixed(1)}vh;--r1:${v.r1.toFixed(0)}deg;--r2:${v.r2.toFixed(0)}deg;--r3:${v.r3.toFixed(0)}deg;--d:${v.d.toFixed(2)}s;--t:${v.t.toFixed(2)}s;--h:${v.h}">${n}</span>`;
    });
    el.innerHTML = html`<div class="shuffle-top"><span class="shuffle-title">${ic('sparkles', { size: 22 })} ${title}</span><span class="shuffle-count" aria-live="polite">${Math.round(ms / 1000)}</span></div>
      <div class="shuffle-bar" aria-hidden="true"><i style="animation-duration:${ms}ms"></i></div>
      <div class="shuffle-field" aria-hidden="true">${chips}</div>
      <div class="shuffle-foot"><span>Misturando ${names.length} ${names.length === 1 ? 'nome' : 'nomes'}…</span><button type="button" class="btn btn-sm btn-light" data-skip>Pular animação</button></div>`.s;
    document.body.append(el);
    document.body.classList.add('no-scroll');
    const count = $('.shuffle-count', el);
    let left = Math.round(ms / 1000), done = false;
    const tick = setInterval(() => { left = Math.max(0, left - 1); count.textContent = String(left); }, 1000);
    const finish = () => {
      if (done) return; done = true;
      clearInterval(tick); clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => { el.remove(); document.body.classList.remove('no-scroll'); resolve(); }, 260);
    };
    const timer = setTimeout(finish, ms);
    cancel = finish;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-skip]')) { finish(); return; }
      const chip = e.target.closest('.shuffle-chip');
      if (chip) { chip.classList.remove('zap'); void chip.offsetWidth; chip.classList.add('zap'); }
    });
    el.querySelector('[data-skip]').focus({ preventScroll: true });
  });
  promise.cancel = () => cancel();
  return promise;
}
