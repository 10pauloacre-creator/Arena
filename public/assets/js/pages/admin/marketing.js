// Marketing: flyer automático com QR Code, link, texto de divulgação e compartilhamento.
import { html, render, ic, $, on, copyText } from '../../ui/dom.js';
import { qrSvg } from '../../ui/qr.js';
import { FORMATS, THEMES, ensureFonts, drawFlyer, flyerData, captionText } from '../../ui/flyer.js';
import { toast } from '../../ui/toast.js';

export default function (app) {
  let fmt = 'feed', theme = 'azul', raf = 0;
  const data = () => flyerData(app.t, app.visitorUrl());

  function view() {
    const t = app.t, d = data();
    return html`
      <div class="page-head"><div><h2>Marketing</h2><p>O flyer usa o nome, a data e o prazo do torneio e se atualiza sozinho: inscrições abertas, final e campeão.</p></div></div>
      <div class="mk-grid">
        <div class="card">
          <h3 class="card-title">${ic('image')} Flyer oficial</h3>
          <div class="row between wrap">
            <div class="seg" role="group" aria-label="Formato do flyer">${Object.entries(FORMATS).map(([k, f]) => html`<button type="button" data-fmt="${k}" aria-pressed="${fmt === k}">${f.label}</button>`)}</div>
            <div class="swatches" role="radiogroup" aria-label="Tema de cor">${Object.entries(THEMES).map(([k, th]) => html`<div class="swatch"><input type="radio" name="theme" id="th-${k}" value="${k}" ${theme === k ? 'checked' : ''}><label for="th-${k}" style="background:${th.swatch}"><span class="sr-only">${th.label}</span></label></div>`)}</div>
          </div>
          <div class="flyer-wrap"><canvas id="flyer" role="img" aria-label="Flyer do torneio ${t.name}"></canvas></div>
          <p class="hint center" style="margin-top:10px;justify-content:center">${FORMATS[fmt].w} × ${FORMATS[fmt].h} px · ${FORMATS[fmt].hint}</p>
          <div class="row wrap" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-act="download">${ic('download', { size: 18 })} Baixar PNG</button><button class="btn" data-act="share">${ic('share', { size: 18 })} Compartilhar</button></div>
        </div>
        <div class="stack">
          <div class="card"><h3 class="card-title">${ic('qr-code')} Link e QR Code</h3>
            <div class="row wrap" style="align-items:flex-start;gap:18px"><div class="qr-box" aria-label="QR Code do link do torneio">${qrSvg(app.visitorUrl(), { margin: 1 })}</div>
              <div class="grow stack-sm" style="min-width:200px"><span class="label">Link do visitante</span><div class="copy-field"><input readonly value="${app.visitorUrl()}" aria-label="Link do visitante"><button class="btn btn-sm" data-act="copy-link">${ic('copy', { size: 15 })} Copiar</button></div>
                <span class="label" style="margin-top:6px">ID do torneio</span><div class="copy-field"><input readonly value="#${t.id}" aria-label="ID do torneio"><button class="btn btn-sm" data-act="copy-id">${ic('copy', { size: 15 })} Copiar</button></div>
                <p class="hint">Cole o QR no flyer impresso: quem escanear abre a página de inscrição.</p></div></div></div>
          <div class="card"><h3 class="card-title">${ic('message-circle')} Texto de divulgação</h3><div class="caption-box" id="caption">${captionText(d)}</div>
            <div class="row wrap" style="margin-top:12px"><button class="btn" data-act="copy-caption">${ic('copy', { size: 16 })} Copiar texto</button><a class="btn" id="waBtn" target="_blank" rel="noopener" data-external href="https://wa.me/?text=${encodeURIComponent(captionText(d))}">${ic('smartphone', { size: 16 })} Enviar no WhatsApp</a></div></div>
        </div>
      </div>`;
  }

  async function paint() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(async () => {
      await ensureFonts();
      const cv = $('#flyer', app.main); if (!cv) return;
      drawFlyer(cv, fmt, data(), theme);
    });
  }
  async function blob(f = fmt) {
    await ensureFonts();
    const cv = document.createElement('canvas'); drawFlyer(cv, f, data(), theme);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  return {
    mount(root) {
      render(root, view()); paint();
      on(root, 'click', '[data-fmt]', (e, el) => { fmt = el.dataset.fmt; render(root, view()); paint(); });
      root.addEventListener('change', e => { if (e.target.name === 'theme') { theme = e.target.value; paint(); } });
      on(root, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act, d = data();
        if (act === 'copy-link') toast((await copyText(app.visitorUrl())) ? 'Link copiado!' : 'Copie manualmente: ' + app.visitorUrl(), { type: 'success', ms: 2200 });
        if (act === 'copy-id') toast((await copyText('#' + app.t.id)) ? 'ID copiado!' : 'Copie manualmente', { type: 'success', ms: 2200 });
        if (act === 'copy-caption') toast((await copyText(captionText(d))) ? 'Texto copiado!' : 'Não foi possível copiar.', { type: 'success', ms: 2200 });
        if (act === 'download' || act === 'share') {
          const b = await blob(); if (!b) { toast('Não foi possível gerar a imagem.', { type: 'error' }); return; }
          const name = `flyer-${app.t.id.toLowerCase()}-${fmt}.png`, file = new File([b], name, { type: 'image/png' });
          if (act === 'share' && navigator.canShare?.({ files: [file] })) {
            try { await navigator.share({ files: [file], title: app.t.name, text: captionText(d) }); return; } catch (err) { if (err.name === 'AbortError') return; }
          }
          const url = URL.createObjectURL(b), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
          toast(act === 'share' ? 'Compartilhamento indisponível neste aparelho: a imagem foi baixada.' : 'Flyer baixado.', { type: 'success' });
        }
      });
    },
    update() { const root = app.main; if (!root) return; const cap = $('#caption', root); if (cap) { cap.textContent = captionText(data()); const wa = $('#waBtn', root); if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(captionText(data())); } paint(); },
  };
}
