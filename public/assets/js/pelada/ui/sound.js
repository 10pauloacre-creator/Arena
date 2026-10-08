// Apito do árbitro no fim da partida (arquivo enviado pelo organizador da plataforma: /pelada/sounds/apito.m4a).
// Tocado com Web Audio (ganho acima do normal + limitador) para sair bem alto; navegadores só liberam som depois de um toque
// do usuário na tela, então `armSound()` prepara o áudio no primeiro toque. Sem áudio disponível, cai para bipes.
const URL_APITO = '/pelada/sounds/apito.m4a';
const URL_APITO_MP3 = '/pelada/sounds/apito.mp3';
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let ctx = null, buffer = null, loading = null;

function context() { if (!ctx && AC) { try { ctx = new AC(); } catch { ctx = null; } } return ctx; }

/** Baixa e decodifica o apito: AAC (m4a) primeiro; navegadores sem AAC (Chromium de código aberto) usam o MP3. */
function decodeFrom(url) {
  return fetch(url).then(r => { if (!r.ok) throw new Error('apito'); return r.arrayBuffer(); })
    .then(data => new Promise((ok, fail) => {
      const pr = ctx.decodeAudioData(data, ok, fail); // forma com callback: vale também no Safari antigo
      pr?.catch?.(() => { /* o erro já chega por `fail` */ });
    }));
}
function load() {
  if (buffer || loading || !context()) return loading;
  loading = decodeFrom(URL_APITO).catch(() => decodeFrom(URL_APITO_MP3))
    .then(b => { buffer = b; }).catch(() => { loading = null; });
  return loading;
}

/** Chamar dentro de um toque/tecla do usuário: libera o áudio e já baixa o apito. */
export function unlockSound() {
  const c = context();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => { /* tenta no próximo toque */ });
  load();
}

/** Prepara o áudio no primeiro toque na tela (e enquanto o contexto não estiver liberado). */
export function armSound(signal) {
  const on = () => { unlockSound(); if (ctx && ctx.state === 'running' && buffer) for (const ev of EVENTS) document.removeEventListener(ev, on); };
  const EVENTS = ['pointerdown', 'touchstart', 'keydown', 'click'];
  for (const ev of EVENTS) document.addEventListener(ev, on, { passive: true, signal });
}

function beeps() {
  const c = context();
  if (!c) return;
  [0, 0.35, 0.7].forEach(t => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1000; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.5, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + 0.28); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.3); });
}

/** Apito de fim de jogo (bem alto) + vibração. */
export async function playWhistle() {
  try { navigator.vibrate?.([400, 120, 400, 120, 900]); } catch { /* sem vibração */ }
  const c = context();
  if (!c) return;
  try {
    if (c.state === 'suspended') await c.resume();
    if (!buffer) await load();
    if (!buffer) return beeps();
    const src = c.createBufferSource(); src.buffer = buffer;
    const gain = c.createGain(); gain.gain.value = 1.6;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
    src.connect(gain); gain.connect(limiter); limiter.connect(c.destination);
    src.start();
  } catch { beeps(); }
}
