const STATUS = { ideia: 'Ideia', teste: 'Em teste', validada: 'Validada', descartada: 'Descartada' };
const STATUS_ORDER = Object.keys(STATUS);
const KEY_V1 = 'painelpupuy.v1';
const KEY_V2 = 'painelpupuy.v2';

let items = [];
let settings = { goal: 0 };
let filter = 'todas';
let query = '';
let tagFilter = new Set();   // tags selecionadas no filtro (a ideia precisa ter todas)
let sortBy = 'recent';
let view = 'grid';
let showArchived = false;
let draft = null;      // cópia da ideia em edição
let draftIsNew = false;

const $ = (id) => document.getElementById(id);
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fmtDate = (s) => s ? s.split('-').reverse().join('/') : '';
const monthKey = (s) => s.slice(0, 7);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => /^https?:\/\//i.test(u) ? u : 'https://' + u;

/* ---------- cálculos ---------- */
const invested = (i) => i.txs.filter((t) => t.type === 'gasto').reduce((a, t) => a + t.value, 0);
const earned = (i) => i.txs.filter((t) => t.type === 'ganho').reduce((a, t) => a + t.value, 0);
const profit = (i) => earned(i) - invested(i);
const roi = (i) => invested(i) > 0 ? (profit(i) / invested(i)) * 100 : null;

/* ---------- persistência ---------- */
function normalize(i) {
  return {
    id: i.id || uid(), title: i.title || '', desc: i.desc || '', status: STATUS[i.status] ? i.status : 'ideia',
    tags: i.tags || [], links: i.links || [], entries: i.entries || [], txs: i.txs || [],
    learned: i.learned || '', next: i.next || '', archived: !!i.archived,
    created: i.created || Date.now(), updated: i.updated || Date.now(),
  };
}
function migrateV1(old) {
  return old.map((o) => {
    const d = new Date(o.created || Date.now()).toISOString().slice(0, 10);
    const n = normalize(o);
    if (o.invested > 0) n.txs.push({ id: uid(), type: 'gasto', value: o.invested, date: d, note: 'Valor migrado' });
    if (o.earned > 0) n.txs.push({ id: uid(), type: 'ganho', value: o.earned, date: d, note: 'Valor migrado' });
    if (o.notes) n.entries.push({ id: uid(), date: d, text: o.notes });
    return n;
  });
}
function applyData(d) {
  items = (d.items || []).map(normalize);
  settings = { goal: 0, ...(d.settings || {}) };
  settings.tags = Array.isArray(settings.tags) ? settings.tags : [];
  reconcileTags();
}

/* ---------- tags: cadastro único, comparação sem acento/maiúscula ---------- */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const sortTags = () => settings.tags.sort((a, b) => a.localeCompare(b, 'pt-BR'));
const canonTag = (name) => settings.tags.find((t) => norm(t) === norm(name));
function ensureTag(name) {
  name = String(name).replace(/\s+/g, ' ').trim();
  if (!name) return null;
  let t = canonTag(name);
  if (!t) { t = name; settings.tags.push(t); sortTags(); }
  return t;
}
// garante que toda tag usada nas ideias esteja no cadastro, com a grafia padrão (une “Tráfego” e “trafego”)
function reconcileTags() {
  for (const i of items) i.tags = [...new Set(i.tags.map(ensureTag).filter(Boolean))];
  const seen = new Set();
  settings.tags = settings.tags.filter((t) => !seen.has(norm(t)) && seen.add(norm(t)));
  sortTags();
}
function snapshot() { return { version: 2, items, settings }; }

let saveTimer;
function save() {
  const json = JSON.stringify(snapshot());
  try { localStorage.setItem(KEY_V2, json); } catch {}
  clearTimeout(saveTimer);
  setState('salvando…');
  saveTimer = setTimeout(async () => {
    if (syncBlocked) return setState('sem conexão com o servidor: salvo só neste navegador');
    try {
      const r = await api('POST', json);
      setState(r.ok ? 'salvo ✓' : 'erro ao salvar: salvo só neste navegador');
    } catch { setState('sem conexão: salvo só neste navegador'); }
  }, 300);
}
function setState(t) { $('saveState').textContent = '· ' + t; }

/* Servidor: localhost (serve.ps1 → data.json) ou Vercel (api/data.js → banco, com senha). */
const KEY_PWD = 'painelpupuy.senha';
let syncBlocked = false;   // true se não deu pra ler o servidor: evita sobrescrever dados com uma cópia vazia
const getPwd = () => { try { return localStorage.getItem(KEY_PWD) || sessionStorage.getItem(KEY_PWD) || ''; } catch { return ''; } };
function setPwd(p, remember) {
  try {
    localStorage.removeItem(KEY_PWD); sessionStorage.removeItem(KEY_PWD);
    (remember ? localStorage : sessionStorage).setItem(KEY_PWD, p);
  } catch {}
}
const rawFetch = (method, body) => fetch('/api/data', {
  method, body, cache: 'no-store',
  headers: { 'Content-Type': 'application/json', 'x-painel-senha': getPwd() },
});

// tela de login: aparece quando o servidor responde 401 (senha ausente ou errada)
let loginPromise = null, loginDone = null;
function askLogin(erro) {
  $('loginErr').textContent = erro || '';
  $('login').hidden = false;
  $('pwd').value = ''; $('pwd').focus();
  if (!loginPromise) loginPromise = new Promise((res) => { loginDone = () => { loginPromise = null; res(); }; });
  return loginPromise;
}
$('loginForm').onsubmit = (e) => {
  e.preventDefault();
  if (!$('pwd').value) return;
  setPwd($('pwd').value, $('remember').checked);
  $('login').hidden = true;
  loginDone();
};
$('logoutBtn').onclick = () => {
  try { localStorage.removeItem(KEY_PWD); sessionStorage.removeItem(KEY_PWD); } catch {}
  location.reload();
};

async function api(method, body) {
  let r = await rawFetch(method, body);
  for (let n = 0; r.status === 401; n++) {
    await askLogin(n || getPwd() ? 'Senha incorreta.' : '');
    r = await rawFetch(method, body);
  }
  return r;
}

async function init() {
  let loaded = false;
  try {
    const r = await api('GET');
    if (r.ok) { applyData(await r.json()); loaded = true; }
    else if (r.status !== 404) syncBlocked = true;
  } catch { syncBlocked = true; }
  if (syncBlocked) {
    // não mostra o painel “aberto” sem o servidor: bloqueia a tela e explica
    $('fatalMsg').textContent = 'O servidor não respondeu direito (ou não está configurado). Verifique a senha e o banco de dados na Vercel e tente de novo.';
    $('fatal').hidden = false;
    return;
  }
  if (loaded && !items.length) loaded = false;   // arquivo vazio: tenta recuperar do navegador
  if (!loaded) {
    try {
      const v2 = localStorage.getItem(KEY_V2);
      const v1 = localStorage.getItem(KEY_V1);
      if (v2) applyData(JSON.parse(v2));
      else if (v1) applyData({ items: migrateV1(JSON.parse(v1)) });
    } catch {}
    if (items.length) save();
  }
  render();
}

/* ---------- renderização ---------- */
function renderStats() {
  const act = items.filter((i) => !i.archived);
  const inv = items.reduce((a, i) => a + invested(i), 0);
  const ear = items.reduce((a, i) => a + earned(i), 0);
  const p = ear - inv;
  const count = (s) => act.filter((i) => i.status === s).length;
  $('stats').innerHTML = `
    <div class="stat"><small>Ideias ativas</small><strong>${act.length}</strong></div>
    <div class="stat"><small>Em teste</small><strong>${count('teste')}</strong></div>
    <div class="stat"><small>Validadas</small><strong>${count('validada')}</strong></div>
    <div class="stat"><small>Investido</small><strong>${brl(inv)}</strong></div>
    <div class="stat"><small>Retorno</small><strong>${brl(ear)}</strong></div>
    <div class="stat"><small>Resultado</small><strong class="${p >= 0 ? 'pos' : 'neg'}">${brl(p)}</strong></div>`;
}

function lastMonths(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let k = n - 1; k >= 0; k--) {
    const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function renderChart() {
  const months = lastMonths(6);
  const all = items.flatMap((i) => i.txs);
  const vals = months.map((m) => all.filter((t) => monthKey(t.date) === m).reduce((a, t) => a + (t.type === 'ganho' ? t.value : -t.value), 0));
  if (!all.length) { $('chart').innerHTML = '<p class="muted pad">Adicione lançamentos financeiros nas ideias para ver o gráfico.</p>'; return; }
  const max = Math.max(1, ...vals.map(Math.abs));
  const W = 420, H = 170, base = H / 2 - 4, bw = 36, gap = (W - bw * 6) / 7;
  const bars = vals.map((v, k) => {
    const h = Math.max(2, (Math.abs(v) / max) * (base - 22));
    const x = gap + k * (bw + gap);
    const y = v >= 0 ? base - h : base;
    const ty = v >= 0 ? y - 5 : y + h + 12;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="5" fill="${v >= 0 ? '#34d399' : '#f87171'}" opacity=".9"/>
      <text x="${x + bw / 2}" y="${ty}" text-anchor="middle" class="cv">${v === 0 ? '' : Math.round(v)}</text>
      <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" class="cl">${MONTHS[+months[k].slice(5) - 1]}</text>`;
  }).join('');
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Resultado por mês"><line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#2d2342"/>${bars}</svg>`;
}

function renderGoal() {
  const m = today().slice(0, 7);
  $('goalMonth').textContent = MONTHS[+m.slice(5) - 1] + '/' + m.slice(0, 4);
  const got = items.flatMap((i) => i.txs).filter((t) => t.type === 'ganho' && monthKey(t.date) === m).reduce((a, t) => a + t.value, 0);
  const g = settings.goal || 0;
  const pct = g > 0 ? Math.min(100, (got / g) * 100) : 0;
  $('goal').innerHTML = `
    <div class="goal-top"><strong>${brl(got)}</strong><span class="muted">de</span>
      <input type="number" id="goalInput" min="0" step="50" value="${g || ''}" placeholder="definir meta"></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <small class="muted">${g > 0 ? (got >= g ? 'Meta batida! 🎉' : `Faltam ${brl(g - got)} (${pct.toFixed(0)}%)`) : 'Defina uma meta de ganhos para o mês.'}</small>`;
  $('goalInput').onchange = (e) => { settings.goal = Math.max(0, parseFloat(e.target.value) || 0); save(); renderGoal(); };
}

function renderFilters() {
  const all = { todas: 'Todas', ...STATUS };
  $('filters').innerHTML = Object.entries(all)
    .map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${v}</button>`).join('');
}

function renderTagFilters() {
  const box = $('tagFilters');
  tagFilter = new Set([...tagFilter].filter((t) => settings.tags.includes(t)));
  box.hidden = !settings.tags.length;
  if (!settings.tags.length) return;
  const count = (t) => items.filter((i) => (showArchived || !i.archived) && i.tags.includes(t)).length;
  box.innerHTML = '<span class="lbl">Tags</span>' + settings.tags
    .map((t) => `<button class="chip ${tagFilter.has(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)} <small>${count(t)}</small></button>`).join('')
    + (tagFilter.size ? '<button class="chip clear" data-tag-clear="1">limpar</button>' : '');
}

function visibleItems(ignoreStatus) {
  const q = norm(query);
  const list = items.filter((i) =>
    (showArchived || !i.archived) &&
    (ignoreStatus || filter === 'todas' || i.status === filter) &&
    [...tagFilter].every((t) => i.tags.includes(t)) &&
    (!q || norm([i.title, i.desc, i.learned, i.next, i.tags.join(' '), i.entries.map((e) => e.text).join(' ')].join(' ')).includes(q)));
  const cmp = {
    recent: (a, b) => b.updated - a.updated,
    profit: (a, b) => profit(b) - profit(a),
    roi: (a, b) => (roi(b) ?? -Infinity) - (roi(a) ?? -Infinity),
    title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  }[sortBy];
  return list.sort(cmp);
}

function cardHTML(i) {
  const r = roi(i), p = profit(i);
  const lastEntry = i.entries.length ? [...i.entries].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  return `
    <article class="card ${i.archived ? 'archived' : ''}" data-id="${i.id}" draggable="true">
      <div class="card-top"><span class="badge s-${i.status}">${STATUS[i.status]}</span>${i.archived ? '<span class="tag">arquivada</span>' : ''}</div>
      <h3>${esc(i.title)}</h3>
      ${i.desc ? `<p class="desc">${esc(i.desc)}</p>` : ''}
      ${i.tags.length ? `<div class="tags">${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${lastEntry ? `<p class="notes"><b>${fmtDate(lastEntry.date)}</b> · ${esc(lastEntry.text)}</p>` : ''}
      ${i.next ? `<p class="next">➜ ${esc(i.next)}</p>` : ''}
      ${i.links.length ? `<div class="tags links">${i.links.map((l) => `<a class="tag link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label || 'link')} ↗</a>`).join('')}</div>` : ''}
      <div class="money">
        <span>Invest. <b>${brl(invested(i))}</b></span>
        <span>Retorno <b>${brl(earned(i))}</b></span>
        <span>${r === null ? '' : `ROI <b class="${r >= 0 ? 'pos' : 'neg'}">${r.toFixed(0)}%</b>`}</span>
      </div>
    </article>`;
}

function renderBoard() {
  const board = $('board');
  const list = visibleItems(view === 'kanban');
  $('empty').hidden = list.length > 0;
  $('empty').textContent = items.length ? 'Nada encontrado com esse filtro.' : 'Nenhuma ideia ainda. Clique em “+ Nova ideia” para começar.';
  if (view === 'kanban') {
    board.className = 'kanban';
    board.innerHTML = STATUS_ORDER.map((s) => {
      const col = list.filter((i) => i.status === s);
      return `<div class="col" data-s="${s}"><div class="col-head s-${s}">${STATUS[s]} <small>${col.length}</small></div>${col.map(cardHTML).join('')}</div>`;
    }).join('');
    $('empty').hidden = true;
  } else {
    board.className = 'grid';
    board.innerHTML = list.map(cardHTML).join('');
  }
}

function render() { renderStats(); renderChart(); renderGoal(); renderFilters(); renderTagFilters(); renderBoard(); }

/* ---------- diálogo ---------- */
const dlg = $('dlg');

function renderDraftLists() {
  const entries = [...draft.entries].sort((a, b) => b.date.localeCompare(a.date));
  $('entries').innerHTML = entries.length ? entries.map((e) => `
    <div class="li"><span class="d">${fmtDate(e.date)}</span><span class="t">${esc(e.text)}</span><button class="x" data-del-e="${e.id}" title="Remover">×</button></div>`).join('')
    : '<p class="muted small">Nenhuma entrada ainda.</p>';
  const txs = [...draft.txs].sort((a, b) => b.date.localeCompare(a.date));
  $('txs').innerHTML = (txs.length ? txs.map((t) => `
    <div class="li"><span class="d">${fmtDate(t.date)}</span><span class="t">${esc(t.note || (t.type === 'gasto' ? 'Gasto' : 'Ganho'))}</span>
      <b class="${t.type === 'ganho' ? 'pos' : 'neg'}">${t.type === 'ganho' ? '+' : '−'}${brl(t.value)}</b><button class="x" data-del-t="${t.id}" title="Remover">×</button></div>`).join('')
    : '<p class="muted small">Nenhum lançamento ainda.</p>')
    + `<p class="small sum">Investido <b>${brl(invested(draft))}</b> · Retorno <b>${brl(earned(draft))}</b> · Resultado <b class="${profit(draft) >= 0 ? 'pos' : 'neg'}">${brl(profit(draft))}</b></p>`;
  $('links').innerHTML = draft.links.length ? draft.links.map((l) => `
    <div class="li"><span class="t"><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a></span><button class="x" data-del-l="${l.id}" title="Remover">×</button></div>`).join('')
    : '<p class="muted small">Nenhum link ainda.</p>';
}

function openDialog(id) {
  const it = items.find((i) => i.id === id);
  draftIsNew = !it;
  draft = it ? structuredClone(it) : normalize({ title: '' });
  $('dlgTitle').textContent = it ? 'Editar ideia' : 'Nova ideia';
  $('delBtn').hidden = draftIsNew;
  $('archBtn').hidden = draftIsNew;
  $('archBtn').textContent = draft.archived ? 'Desarquivar' : 'Arquivar';
  $('fStatus').innerHTML = STATUS_ORDER.map((k) => `<option value="${k}">${STATUS[k]}</option>`).join('');
  $('fTitle').value = draft.title;
  $('fDesc').value = draft.desc;
  $('fStatus').value = draft.status;
  $('tagIn').value = '';
  renderTagPicker();
  $('fLearned').value = draft.learned;
  $('fNext').value = draft.next;
  $('eDate').value = today(); $('eText').value = '';
  $('tDate').value = today(); $('tValue').value = ''; $('tNote').value = ''; $('tType').value = 'gasto';
  $('lLabel').value = ''; $('lUrl').value = '';
  renderDraftLists();
  dlg.showModal();
  dlg.querySelector('.dlg-body').scrollTop = 0;
}

function readFields() {
  draft.title = $('fTitle').value.trim();
  draft.desc = $('fDesc').value.trim();
  draft.status = $('fStatus').value;
  draft.learned = $('fLearned').value.trim();
  draft.next = $('fNext').value.trim();
}

function commit() {
  readFields();
  if (!draft.title) { $('fTitle').focus(); $('fTitle').classList.add('invalid'); return false; }
  draft.updated = Date.now();
  const idx = items.findIndex((i) => i.id === draft.id);
  if (idx >= 0) items[idx] = draft; else items.unshift(draft);
  save(); render();
  return true;
}

$('fTitle').oninput = () => $('fTitle').classList.remove('invalid');

$('eAdd').onclick = () => {
  const text = $('eText').value.trim();
  if (!text) return $('eText').focus();
  draft.entries.push({ id: uid(), date: $('eDate').value || today(), text });
  $('eText').value = ''; renderDraftLists();
};
$('tAdd').onclick = () => {
  const value = parseFloat($('tValue').value);
  if (!(value > 0)) return $('tValue').focus();
  draft.txs.push({ id: uid(), type: $('tType').value, value, date: $('tDate').value || today(), note: $('tNote').value.trim() });
  $('tValue').value = ''; $('tNote').value = ''; renderDraftLists();
};
$('lAdd').onclick = () => {
  const url = $('lUrl').value.trim();
  if (!url) return $('lUrl').focus();
  draft.links.push({ id: uid(), label: $('lLabel').value.trim(), url });
  $('lLabel').value = ''; $('lUrl').value = ''; renderDraftLists();
};
for (const [input, btn] of [['eText', 'eAdd'], ['tNote', 'tAdd'], ['tValue', 'tAdd'], ['lUrl', 'lAdd']]) {
  $(input).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(btn).click(); } });
}
dlg.addEventListener('click', (e) => {
  const d = (a) => e.target.dataset[a];
  if (d('delE')) draft.entries = draft.entries.filter((x) => x.id !== d('delE'));
  else if (d('delT')) draft.txs = draft.txs.filter((x) => x.id !== d('delT'));
  else if (d('delL')) draft.links = draft.links.filter((x) => x.id !== d('delL'));
  else return;
  renderDraftLists();
});

/* seletor de tags dentro da ideia */
function renderTagPicker() {
  $('tagSel').innerHTML = draft.tags.length
    ? draft.tags.map((t) => `<span class="tag sel">${esc(t)}<button type="button" class="x" data-rm-tag="${esc(t)}" title="Remover">×</button></span>`).join('')
    : '<span class="muted small">Nenhuma tag.</span>';
  const raw = $('tagIn').value.trim(), q = norm(raw);
  const avail = settings.tags.filter((t) => !draft.tags.includes(t) && (!q || norm(t).includes(q)));
  const exists = q && settings.tags.some((t) => norm(t) === q);
  $('tagSug').innerHTML = avail.map((t) => `<button type="button" class="chip" data-add-tag="${esc(t)}">${esc(t)}</button>`).join('')
    + (q && !exists ? `<button type="button" class="chip new" data-new-tag="1">+ Criar “${esc(raw)}”</button>` : '')
    + (!avail.length && !q ? '<span class="muted small">Digite para criar a primeira tag.</span>' : '');
}
function addDraftTag(name) {
  const t = ensureTag(name);
  if (t && !draft.tags.includes(t)) draft.tags.push(t);
  $('tagIn').value = '';
  renderTagPicker();
}
$('tagIn').oninput = renderTagPicker;
$('tagIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    if ($('tagIn').value.trim()) addDraftTag($('tagIn').value);
  } else if (e.key === 'Backspace' && !$('tagIn').value && draft.tags.length) {
    draft.tags.pop(); renderTagPicker();
  }
});
$('tagBox').addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (d.addTag) addDraftTag(d.addTag);
  else if (d.newTag) addDraftTag($('tagIn').value);
  else if (d.rmTag) { draft.tags = draft.tags.filter((t) => t !== d.rmTag); renderTagPicker(); }
});

/* gerenciador de tags (renomear, unir, excluir) */
const tagsDlg = $('tagsDlg');
const tagCount = (t) => items.filter((i) => i.tags.includes(t)).length;
function renderTagManager() {
  $('tagList').innerHTML = settings.tags.length ? settings.tags.map((t) => `
    <div class="li"><input class="tag-name" value="${esc(t)}" data-old="${esc(t)}" maxlength="40">
      <span class="muted small">${tagCount(t)} ideia(s)</span>
      <button class="x" data-del-tag="${esc(t)}" title="Excluir tag">🗑</button></div>`).join('')
    : '<p class="muted small">Ainda não há tags. Crie dentro de uma ideia.</p>';
}
function replaceTag(oldName, newName) {   // newName null = remover
  for (const i of items) {
    if (!i.tags.includes(oldName)) continue;
    i.tags = [...new Set(i.tags.map((t) => t === oldName ? newName : t).filter(Boolean))];
    i.updated = Date.now();
  }
  settings.tags = settings.tags.filter((t) => t !== oldName);
  if (newName && !settings.tags.includes(newName)) settings.tags.push(newName);
  sortTags();
  tagFilter.delete(oldName);
  save(); render(); renderTagManager();
}
$('tagsBtn').onclick = () => { renderTagManager(); tagsDlg.showModal(); };
$('tagsClose').onclick = () => tagsDlg.close();
$('tagList').addEventListener('change', (e) => {
  const inp = e.target.closest('.tag-name'); if (!inp) return;
  const old = inp.dataset.old;
  const novo = inp.value.replace(/\s+/g, ' ').trim();
  if (!novo || novo === old) { inp.value = old; return; }
  const outra = settings.tags.find((t) => t !== old && norm(t) === norm(novo));
  if (outra) {
    if (!confirm(`Já existe a tag “${outra}”. Unir “${old}” com ela? As ideias passam a usar “${outra}”.`)) { inp.value = old; return; }
    replaceTag(old, outra);
  } else replaceTag(old, novo);
});
$('tagList').addEventListener('click', (e) => {
  const t = e.target.dataset.delTag; if (!t) return;
  const n = tagCount(t);
  if (confirm(`Excluir a tag “${t}”${n ? ` e removê-la de ${n} ideia(s)` : ''}?`)) replaceTag(t, null);
});

$('saveBtn').onclick = () => { if (commit()) dlg.close(); };
$('cancelBtn').onclick = () => dlg.close();
$('archBtn').onclick = () => { draft.archived = !draft.archived; if (commit()) dlg.close(); };
$('delBtn').onclick = () => {
  if (confirm('Excluir esta ideia? Isso não pode ser desfeito.')) {
    items = items.filter((i) => i.id !== draft.id);
    save(); render(); dlg.close();
  }
};

/* ---------- interações da tela ---------- */
$('newBtn').onclick = () => openDialog(null);
$('board').onclick = (e) => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('.card');
  if (card) openDialog(card.dataset.id);
};
$('filters').onclick = (e) => {
  const b = e.target.closest('[data-f]');
  if (b) { filter = b.dataset.f; renderFilters(); renderBoard(); }
};
$('search').oninput = (e) => { query = e.target.value; renderBoard(); };
$('sort').onchange = (e) => { sortBy = e.target.value; renderBoard(); };
$('showArchived').onchange = (e) => { showArchived = e.target.checked; renderTagFilters(); renderBoard(); };
$('tagFilters').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tagClear) tagFilter.clear();
  else if (tagFilter.has(b.dataset.tag)) tagFilter.delete(b.dataset.tag);
  else tagFilter.add(b.dataset.tag);
  renderTagFilters(); renderBoard();
};
$('viewSeg').onclick = (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  view = b.dataset.v;
  document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('filters').hidden = view === 'kanban';
  renderBoard();
};

// arrastar cards entre colunas (Kanban)
let dragId = null;
$('board').addEventListener('dragstart', (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  dragId = c.dataset.id; c.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('board').addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); });
$('board').addEventListener('dragover', (e) => {
  const col = e.target.closest('.col'); if (!col || !dragId) return;
  e.preventDefault();
  document.querySelectorAll('.col.over').forEach((x) => x !== col && x.classList.remove('over'));
  col.classList.add('over');
});
$('board').addEventListener('drop', (e) => {
  const col = e.target.closest('.col'); if (!col || !dragId) return;
  e.preventDefault();
  const it = items.find((i) => i.id === dragId);
  if (it && it.status !== col.dataset.s) { it.status = col.dataset.s; it.updated = Date.now(); save(); render(); }
});

/* ---------- exportar / importar ---------- */
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
  a.download = `painelpupuy-backup-${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const d = Array.isArray(data) ? { items: migrateV1(data) } : data;   // aceita backup antigo (v1)
    if (!Array.isArray(d.items)) throw new Error();
    if (confirm(`Importar ${d.items.length} ideias? Isso substitui os dados atuais.`)) { applyData(d); save(); render(); }
  } catch { alert('Arquivo inválido.'); }
  e.target.value = '';
};

// ao voltar para a aba, puxa alterações feitas em outro aparelho
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || dlg.open || syncBlocked) return;
  try {
    const r = await api('GET');
    if (!r.ok) return;
    const remote = await r.json();
    if (JSON.stringify(remote) !== JSON.stringify(snapshot()) && !dlg.open) { applyData(remote); render(); }
  } catch {}
});

init();
