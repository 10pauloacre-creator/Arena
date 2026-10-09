// Compartilhar um link: botão do ícone de compartilhar + janela com as opções (apps do celular, WhatsApp, Telegram…) e "Copiar link".
import { html, ic, copyText } from './dom.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';

const enc = encodeURIComponent;

/** Endereço completo (com o domínio de quem está usando) a partir de um caminho como "/AM-2026-9843/a-x-b". */
export const absUrl = path => new URL(path, location.origin).href;

/** Botão do ícone de compartilhar; o clique é tratado por `wireShare`. */
export const shareButton = (label = 'Compartilhar', { cls = 'btn btn-sm' } = {}) =>
  html`<button type="button" class="${cls}" data-share aria-label="${label}">${ic('share', { size: 16 })} <span>${label}</span></button>`;

/** Liga todos os [data-share] dentro de `root` a `getInfo()` → { title, text, url (caminho ou endereço completo) }. */
export function wireShare(root, getInfo, signal) {
  root.addEventListener('click', e => {
    if (!e.target.closest('[data-share]')) return;
    const info = getInfo();
    if (info) openShareDialog(info);
  }, signal ? { signal } : undefined);
}

/** `image` (opcional): { src, feed, name } — flyer do confronto com prévia, "Baixar imagem" e "Enviar imagem". */
export function openShareDialog({ title = 'Compartilhar', heading, text, url, image = null }) {
  const link = absUrl(url);
  const msg = `${text || heading || title}\n${link}`;
  const canNative = typeof navigator.share === 'function';
  const canFiles = !!image && canNative && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  const opts = [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'message-circle', href: `https://wa.me/?text=${enc(msg)}` },
    { key: 'telegram', label: 'Telegram', icon: 'arrow-up-right', href: `https://t.me/share/url?url=${enc(link)}&text=${enc(text || heading || title)}` },
    { key: 'facebook', label: 'Facebook', icon: 'globe', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}` },
    { key: 'x', label: 'X', icon: 'external-link', href: `https://twitter.com/intent/tweet?text=${enc(text || heading || title)}&url=${enc(link)}` },
    { key: 'email', label: 'E-mail', icon: 'mail', href: `mailto:?subject=${enc(heading || title)}&body=${enc(msg)}` },
  ];
  const d = openDialog({
    title,
    body: html`${image ? html`<figure class="share-flyer"><img src="${image.src}" alt="Flyer do confronto: ${heading || ''}" width="1200" height="630" loading="lazy">
        <figcaption class="row wrap" style="gap:8px"><a class="btn btn-sm" href="${image.feed}" download="${image.name || 'confronto'}.png">${ic('download', { size: 15 })} Baixar imagem</a>${canFiles ? html`<button type="button" class="btn btn-sm" data-share-img>${ic('image', { size: 15 })} Enviar imagem</button>` : ''}</figcaption></figure>` : ''}
      ${heading ? html`<div><b>${heading}</b>${text && text !== heading ? html`<p class="muted small" style="margin:4px 0 0">${text}</p>` : ''}</div>` : ''}
      <div class="share-opts">
        ${canNative ? html`<button type="button" class="share-opt" data-native>${ic('share', { size: 22 })}<span>Enviar para…</span></button>` : ''}
        ${opts.map(o => html`<a class="share-opt" data-opt="${o.key}" href="${o.href}" target="_blank" rel="noopener noreferrer">${ic(o.icon, { size: 22 })}<span>${o.label}</span></a>`)}
      </div>
      <div class="share-link"><input type="text" readonly value="${link}" aria-label="Link para compartilhar" data-link><button type="button" class="btn btn-primary" data-copy>${ic('copy', { size: 16 })} Copiar link</button></div>`,
  });
  const input = d.el.querySelector('[data-link]');
  input.addEventListener('focus', () => input.select());
  d.el.querySelector('[data-copy]').addEventListener('click', async () => {
    const ok = await copyText(link);
    if (!ok) input.select();
    toast(ok ? 'Link copiado!' : 'Não foi possível copiar sozinho: o link está selecionado, é só copiar.', { type: ok ? 'success' : 'warn' });
  });
  d.el.querySelector('[data-native]')?.addEventListener('click', async () => {
    try { await navigator.share({ title: heading || title, text: text || heading || title, url: link }); d.close(); }
    catch (err) { if (err?.name !== 'AbortError') toast('Não foi possível abrir o compartilhamento do aparelho.', { type: 'warn' }); }
  });
  d.el.querySelector('[data-share-img]')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const blob = await (await fetch(image.feed)).blob();
      await navigator.share({ files: [new File([blob], `${image.name || 'confronto'}.png`, { type: 'image/png' })], title: heading || title, text: `${text || heading || title}
${link}` });
    } catch (err) { if (err?.name !== 'AbortError') toast('Não foi possível enviar a imagem. Use "Baixar imagem".', { type: 'warn' }); }
    finally { btn.disabled = false; }
  });
  return d;
}
