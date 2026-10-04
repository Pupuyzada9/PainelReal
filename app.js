const STATUS = { ideia: 'Ideia', teste: 'Em teste', validada: 'Validada', descartada: 'Descartada' };
const STATUS_ORDER = Object.keys(STATUS);
const KEY_V1 = 'painelpupuy.v1';
const KEY_V2 = 'painelpupuy.v2';

let items = [];
let settings = { goal: 0 };
let filter = 'todas';
let query = '';
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
}
function snapshot() { return { version: 2, items, settings }; }

let saveTimer;
function save() {
  const json = JSON.stringify(snapshot());
  try { localStorage.setItem(KEY_V2, json); } catch {}
  clearTimeout(saveTimer);
  setState('salvando…');
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      setState(r.ok ? 'salvo em arquivo ✓' : 'salvo só no navegador');
    } catch { setState('salvo só no navegador'); }
  }, 300);
}
function setState(t) { $('saveState').textContent = '· ' + t; }

async function init() {
  let loaded = false;
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (r.ok) { applyData(await r.json()); loaded = true; }
  } catch {}
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

function visibleItems(ignoreStatus) {
  const q = query.trim().toLowerCase();
  const list = items.filter((i) =>
    (showArchived || !i.archived) &&
    (ignoreStatus || filter === 'todas' || i.status === filter) &&
    (!q || [i.title, i.desc, i.learned, i.next, i.tags.join(' '), i.entries.map((e) => e.text).join(' ')].join(' ').toLowerCase().includes(q)));
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

function render() { renderStats(); renderChart(); renderGoal(); renderFilters(); renderBoard(); }

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
  $('fTags').value = draft.tags.join(', ');
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
  draft.tags = $('fTags').value.split(',').map((t) => t.trim()).filter(Boolean);
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
$('showArchived').onchange = (e) => { showArchived = e.target.checked; renderBoard(); };
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

init();
