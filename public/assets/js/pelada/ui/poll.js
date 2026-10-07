// Atualização periódica (polling) que pausa com a aba escondida e para ao sair da tela.
export function poll(ctx, fn, { ms = 4000 } = {}) {
  let timer = 0, stopped = false, running = false;
  const loop = async () => {
    clearTimeout(timer);
    if (stopped) return;
    if (!document.hidden && !running) { running = true; try { await fn(); } catch { /* tenta de novo no próximo ciclo */ } running = false; }
    if (!stopped) timer = setTimeout(loop, ms);
  };
  timer = setTimeout(loop, ms);
  const stop = () => { stopped = true; clearTimeout(timer); };
  ctx.onLeave(stop);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); }, { signal: ctx.signal });
  return { stop, now: loop };
}
