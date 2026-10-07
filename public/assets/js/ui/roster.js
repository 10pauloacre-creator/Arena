// Editor de elenco reutilizável (inscrição do visitante e cadastro manual do organizador).
import { html, render, ic, $, $$, esc } from './dom.js';
import { toast } from './toast.js';
import { setFieldError } from './forms.js';
import { SPORTS } from '../shared/sports.js';
import { maskCPF, validCPF, cpfDigits } from '../shared/validators.js';
import { session } from '../session.js';

const FIRST = ['Lucas', 'Mateus', 'Gabriel', 'Rafael', 'Bruno', 'Thiago', 'Felipe', 'Diego', 'André', 'Caio', 'Vitor', 'Igor', 'Renan', 'Pedro', 'Nathan', 'Otávio', 'Leandro', 'Murilo', 'Davi', 'Enzo'];
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Lima', 'Costa', 'Ribeiro', 'Almeida', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barros', 'Moreira'];
const rnd = n => Math.floor(Math.random() * n);

function genCpf() {
  const n = Array.from({ length: 9 }, () => rnd(10));
  const dv = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * (a.length + 1 - i); return (s * 10) % 11 % 10; };
  const d1 = dv(n), d2 = dv([...n, d1]);
  return maskCPF([...n, d1, d2].join(''));
}

/**
 * Cria o editor dentro de `root`.
 * opts: { sport, official, players, onChange }
 * Retorna { getPlayers(), validate(), setPlayers(list) }
 */
export function createRosterEditor(root, { sport: sportKey, official = false, players = [], onChange = () => {} }) {
  const sport = SPORTS[sportKey];
  let list = players.map((p, i) => ({ ...p, _id: i + 1 }));
  let seq = list.length;
  let editing = null, doc = null;

  const skeleton = html`<div class="roster-editor stack">
    <div><div class="row between small" style="margin-bottom:6px"><strong>Elenco</strong><span class="num muted" data-count></span></div><div class="progress" aria-hidden="true"><span data-bar style="width:0"></span></div><p class="hint" style="margin-top:6px">${sport.rosterHint}</p></div>
    <div class="card" style="padding:14px;background:var(--surface-2);box-shadow:none" role="group" aria-label="Adicionar atleta">
      <div class="add-row ${official ? 'official' : ''}">
        <div class="field" data-f="name"><label for="r-name-${seq}">Nome do atleta</label><input id="r-name-${seq}" data-in="name" maxlength="40" autocomplete="off" placeholder="Nome completo"><span class="field-error"></span></div>
        <div class="field" data-f="number"><label for="r-num-${seq}">Camisa</label><input id="r-num-${seq}" data-in="number" type="number" min="0" max="99" inputmode="numeric" placeholder="10"><span class="field-error"></span></div>
        ${official ? html`
          <div class="field" data-f="cpf"><label>CPF</label><input data-in="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"><span class="field-error"></span></div>
          <div class="field" data-f="rg"><label>RG</label><input data-in="rg" maxlength="16" autocomplete="off" placeholder="Número do RG"><span class="field-error"></span></div>
          <div class="field full" data-f="doc"><span class="label">Documento de identidade (PDF)</span><label class="drop" style="min-height:52px;padding:8px 12px"><span class="prev" style="width:36px;height:36px">${ic('file-text', { size: 18 })}</span><span class="grow ellipsis" data-docname>Selecionar PDF · até 5 MB</span><input type="file" data-in="doc" accept="application/pdf,.pdf"></label><span class="field-error"></span></div>` : ''}
        <div class="${official ? 'full' : ''}" style="display:flex;gap:8px;align-items:end"><button type="button" class="btn btn-primary" data-act="add" style="flex:1">${ic('user-plus', { size: 18 })} <span data-addlbl>Adicionar</span></button><button type="button" class="btn" data-act="cancel-edit" hidden>Cancelar</button></div>
      </div>
      ${session.config?.payments?.mock ? html`<button type="button" class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="demo">${ic('wand-sparkles', { size: 16 })} Preencher elenco de exemplo (teste)</button>` : ''}
    </div>
    <ul class="player-grid" data-list aria-label="Atletas cadastrados"></ul>
    <span class="field-error" data-listerr style="display:none;color:var(--red);font-weight:600;font-size:13px"></span>
  </div>`;
  render(root, skeleton);

  const q = s => $(s, root);
  const inp = n => $(`[data-in=${n}]`, root);
  const field = n => $(`[data-f=${n}]`, root);

  function paint() {
    $('[data-count]', root).textContent = `${list.length}/${sport.min}${list.length > sport.min ? ` (máx. ${sport.max})` : ''}`;
    $('[data-bar]', root).style.width = Math.min(100, list.length / sport.min * 100) + '%';
    const ul = q('[data-list]');
    ul.innerHTML = list.length ? list.slice().sort((a, b) => a.number - b.number).map(p => `
      <li class="player" data-pid="${p._id}"><span class="jersey">${p.number}</span>
        <div class="grow" style="min-width:0"><div class="p-n ellipsis">${esc(p.name)}</div>${official ? `<div class="p-s ellipsis">${esc(p.cpf || '')} ${p.doc ? '· PDF anexado' : ''}</div>` : ''}</div>
        <button type="button" class="icon-btn" data-act="edit" aria-label="Editar ${esc(p.name)}">${ic('pencil', { size: 16 }).s}</button>
        <button type="button" class="icon-btn" data-act="del" aria-label="Remover ${esc(p.name)}">${ic('trash', { size: 16 }).s}</button></li>`).join('')
      : `<li class="empty" style="grid-column:1/-1">${ic('users').s}<span>Nenhum atleta ainda. Adicione os jogadores acima.</span></li>`;
    onChange(list);
  }

  function clearForm() {
    ['name', 'number', 'cpf', 'rg'].forEach(n => { const i = inp(n); if (i) i.value = ''; setFieldError(field(n), ''); });
    if (official) { inp('doc').value = ''; doc = null; $('[data-docname]', root).textContent = 'Selecionar PDF · até 5 MB'; setFieldError(field('doc'), ''); }
    editing = null; $('[data-addlbl]', root).textContent = 'Adicionar'; $('[data-act=cancel-edit]', root).hidden = true;
  }

  function addOrSave() {
    let ok = true, first = null;
    const bad = (n, m) => { setFieldError(field(n), m); ok = false; first = first || inp(n); };
    ['name', 'number', 'cpf', 'rg', 'doc'].forEach(n => field(n) && setFieldError(field(n), ''));
    const name = inp('name').value.trim().replace(/\s+/g, ' '), numRaw = inp('number').value.trim(), num = Number(numRaw);
    if (name.length < 3) bad('name', 'Informe o nome completo (mín. 3 letras).');
    if (numRaw === '' || !Number.isInteger(num) || num < 0 || num > 99) bad('number', '0 a 99.');
    else if (list.some(p => p.number === num && p._id !== editing)) bad('number', `A camisa ${num} já está em uso.`);
    let cpf = '', rg = '';
    if (official) {
      cpf = inp('cpf').value.trim(); rg = inp('rg').value.trim();
      if (!validCPF(cpf)) bad('cpf', 'CPF inválido.');
      else if (list.some(p => cpfDigits(p.cpf) === cpfDigits(cpf) && p._id !== editing)) bad('cpf', 'CPF já usado no elenco.');
      if (rg.replace(/[^0-9a-z]/gi, '').length < 5) bad('rg', 'Informe o RG.');
      if (!doc) bad('doc', 'Anexe o PDF do documento.');
    }
    if (list.length >= sport.max && editing === null) { toast(`Limite de ${sport.max} atletas para ${sport.label}.`, { type: 'warn' }); return; }
    if (!ok) { first?.focus(); return; }
    const entry = { name, number: num, ...(official ? { cpf, rg, doc } : {}) };
    if (editing !== null) Object.assign(list.find(p => p._id === editing), entry); else list.push({ ...entry, _id: ++seq });
    clearForm(); paint(); inp('name').focus();
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, pid = +b.closest('[data-pid]')?.dataset.pid;
    if (act === 'add') addOrSave();
    if (act === 'cancel-edit') clearForm();
    if (act === 'del') { const p = list.find(x => x._id === pid); list = list.filter(x => x._id !== pid); paint(); toast(`${p.name} removido.`, { type: 'info', ms: 5000, action: { label: 'Desfazer', fn: () => { list.push(p); paint(); } } }); }
    if (act === 'edit') {
      const p = list.find(x => x._id === pid); editing = pid;
      inp('name').value = p.name; inp('number').value = p.number;
      if (official) { inp('cpf').value = p.cpf || ''; inp('rg').value = p.rg || ''; doc = p.doc || null; $('[data-docname]', root).textContent = doc ? doc.name : 'Selecionar PDF · até 5 MB'; }
      $('[data-addlbl]', root).textContent = 'Salvar atleta'; $('[data-act=cancel-edit]', root).hidden = false; inp('name').focus(); inp('name').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (act === 'demo') {
      const used = new Set(list.map(p => p.number)), cpfs = new Set(list.map(p => p.cpf));
      while (list.length < sport.min) {
        let n; do { n = 1 + rnd(30); } while (used.has(n)); used.add(n);
        let c = genCpf(); while (cpfs.has(c)) c = genCpf(); cpfs.add(c);
        list.push({ _id: ++seq, name: `${FIRST[rnd(FIRST.length)]} ${LAST[rnd(LAST.length)]}`, number: n, ...(official ? { cpf: c, rg: `${10 + rnd(89)}${100 + rnd(899)}${100 + rnd(899)}`, doc: { name: `identidade-${seq}.pdf`, size: 80_000 } } : {}) });
      }
      paint(); toast('Elenco de exemplo preenchido (somente para testes).', { type: 'success', ms: 2500 });
    }
  });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-in]:not([type=file])')) { e.preventDefault(); addOrSave(); } });
  if (official) {
    inp('cpf').addEventListener('input', e => { e.target.value = maskCPF(e.target.value); });
    inp('doc').addEventListener('change', e => {
      const f = e.target.files[0]; setFieldError(field('doc'), '');
      if (!f) { doc = null; return; }
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setFieldError(field('doc'), 'Envie o documento em PDF.'); e.target.value = ''; doc = null; return; }
      if (f.size > 5 * 1024 * 1024) { setFieldError(field('doc'), 'O PDF excede 5 MB.'); e.target.value = ''; doc = null; return; }
      doc = { name: f.name, size: f.size }; $('[data-docname]', root).textContent = f.name;
    });
  }
  paint();

  return {
    getPlayers: () => list.map(({ _id, ...p }) => p),
    setPlayers: l => { list = l.map((p, i) => ({ ...p, _id: ++seq + i })); paint(); },
    validate() {
      const err = $('[data-listerr]', root);
      let msg = '';
      if (list.length < sport.min) msg = `O elenco precisa de ao menos ${sport.min} atletas (faltam ${sport.min - list.length}).`;
      else if (list.length > sport.max) msg = `O elenco pode ter no máximo ${sport.max} atletas.`;
      err.style.display = msg ? 'block' : 'none'; err.textContent = msg;
      return !msg;
    },
  };
}
