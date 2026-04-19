// ─── Utilities ────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

function qs(obj) {
  return new URLSearchParams(
    Object.entries(obj).filter(([, v]) => v != null && v !== '')
  ).toString();
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`${res.status}: ${data.error ?? res.statusText}`);
  }
  return res.json();
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function langForPath(file) {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript';
  if (file.endsWith('.js') || file.endsWith('.jsx')) return 'javascript';
  if (file.endsWith('.java')) return 'java';
  return 'none';
}

// ─── Search page ──────────────────────────────────────────────────────────────

async function runSearchPage() {
  const params = new URLSearchParams(location.search);
  const form = $('#search-form');

  for (const k of ['repo', 'commit', 'q']) {
    const v = params.get(k);
    if (v) form.elements[k].value = v;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    history.pushState({}, '', '/?' + qs(data));
    await doSearch(data);
  });

  if (params.get('q') && params.get('repo')) {
    await doSearch(Object.fromEntries(params));
  }
}

async function doSearch({ q, repo, commit }) {
  $('#error').hidden = true;
  $('#results').innerHTML = '<li class="loading">searching…</li>';
  try {
    const { symbols } = await apiGet('/v1/search?' + qs({ q, repo, commit }));
    renderResults(symbols, { repo, commit });
  } catch (e) {
    $('#results').innerHTML = '';
    showError(e.message);
  }
}

function renderResults(symbols, ctx) {
  const ul = $('#results');
  if (!symbols.length) {
    ul.innerHTML = '<li class="empty">no results</li>';
    return;
  }
  ul.innerHTML = symbols.map((s) => `
    <li>
      <a href="/s/${s.symbol_key}?${qs(ctx)}">
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="kind">${escapeHtml(s.kind)}</span>
        <span class="loc">${escapeHtml(s.file_path)}:${s.start_line}</span>
      </a>
    </li>`).join('');
}

// ─── Symbol page ──────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;

async function runSymbolPage() {
  const m = location.pathname.match(/^\/s\/([0-9a-f]{64})$/);
  if (!m) {
    showError('Invalid symbol URL');
    return;
  }
  const key = m[1];

  try {
    const [{ symbol }, bodyPayload, { occurrences }] = await Promise.all([
      apiGet(`/v1/symbols/${key}`),
      apiGet(`/v1/symbols/${key}/body`),
      apiGet(`/v1/symbols/${key}/references`),
    ]);
    renderSymbol(symbol, bodyPayload);
    renderRefs(occurrences);
  } catch (e) {
    showError(e.message);
  }
}

function renderSymbol(symbol, { body, file_path, start_line, end_line }) {
  document.title = `${symbol.name} — codebase-analysis`;
  $('#sym-name').textContent = symbol.name;
  $('#sym-kind').textContent = symbol.kind;
  $('#sym-file').textContent = file_path;
  $('#sym-lines').textContent = `${start_line}–${end_line}`;
  $('#sym-signature').textContent = symbol.signature ?? '';

  const codeEl = $('#sym-body');
  const lang = langForPath(file_path);
  if (lang !== 'none') codeEl.className = `language-${lang}`;
  codeEl.textContent = body;
  if (window.Prism && lang !== 'none') Prism.highlightElement(codeEl);
}

function renderRefs(occs) {
  const ul = $('#sym-refs');
  if (!occs.length) {
    ul.innerHTML = '<li class="empty">no references found</li>';
    return;
  }
  ul.innerHTML = occs.map((o) => `
    <li>
      <span class="kind">${escapeHtml(o.kind)}</span>
      <span class="name">${escapeHtml(o.callee_name)}</span>
      <span class="loc">${escapeHtml(o.file_path)}:${o.line}</span>
    </li>`).join('');
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const p = location.pathname;
if (p === '/' || p.endsWith('/index.html')) {
  runSearchPage();
} else if (p.startsWith('/s/')) {
  runSymbolPage();
}
