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
  if (!Q_ALLOWED.test(q ?? '')) {
    $('#results').innerHTML = '';
    showError(MSG_Q_INVALID);
    return;
  }
  $('#results').innerHTML = '<li class="loading">searching…</li>';
  try {
    const { symbols } = await apiGet('/v1/search?' + qs({ q, repo, commit }));
    renderResults(symbols, { repo, commit });
  } catch (e) {
    $('#results').innerHTML = '';
    const m = String(e.message);
    if (m.startsWith('404:'))      showError(MSG_NOT_READY);
    else if (m.startsWith('400:')) showError(`${MSG_Q_INVALID}\n(서버 응답: ${m})`);
    else                            showError(m);
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

const Q_ALLOWED = /^[A-Za-z0-9_]+$/;
const MSG_Q_INVALID = '검색어는 영문/숫자/`_`만 허용됩니다. 한국어 식별자·경로 필터는 아직 미지원입니다. (OQ-009)';
const MSG_NOT_READY = '해당 repo/commit의 ready index를 찾을 수 없습니다. `analyze push` 완료 여부 또는 URL에 `?commit=<sha>` 명시를 확인하세요.';

const HEX64 = /^[0-9a-f]{64}$/;

async function runSymbolPage() {
  const m = location.pathname.match(/^\/s\/([0-9a-f]{64})$/);
  if (!m) {
    showError('Invalid symbol URL');
    return;
  }
  const key = m[1];
  const params = new URLSearchParams(location.search);
  const ctx = { repo: params.get('repo') ?? '', commit: params.get('commit') ?? '' };

  try {
    const [{ symbol }, bodyPayload, { occurrences }] = await Promise.all([
      apiGet(`/v1/symbols/${key}`),
      apiGet(`/v1/symbols/${key}/body`),
      apiGet(`/v1/symbols/${key}/references`),
    ]);
    renderSymbol(symbol, bodyPayload);
    renderRefs(occurrences, ctx);
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

  const sigEl = $('#sym-signature');
  const lang = langForPath(file_path);
  if (lang !== 'none') sigEl.className = `language-${lang}`;
  sigEl.textContent = symbol.signature ?? '';
  if (window.Prism && lang !== 'none') Prism.highlightElement(sigEl);

  const codeEl = $('#sym-body');
  if (lang !== 'none') codeEl.className = `language-${lang}`;
  codeEl.textContent = body;
  if (window.Prism && lang !== 'none') Prism.highlightElement(codeEl);
}

function renderRefs(occs, ctx) {
  const ul = $('#sym-refs');
  if (!occs.length) {
    ul.innerHTML = '<li class="empty">no references found</li>';
    return;
  }
  ul.innerHTML = occs.map((o) => {
    const nameHtml = Q_ALLOWED.test(o.callee_name)
      ? `<a class="name" href="/?${qs({ ...ctx, q: o.callee_name })}">${escapeHtml(o.callee_name)}</a>`
      : `<span class="name">${escapeHtml(o.callee_name)}</span>`;
    const locHtml = `<a class="loc" href="/f?${qs({ ...ctx, path: o.file_path })}">${escapeHtml(o.file_path)}:${o.line}</a>`;
    return `<li><span class="kind">${escapeHtml(o.kind)}</span>${nameHtml}${locHtml}</li>`;
  }).join('');
}

// ─── File page ────────────────────────────────────────────────────────────────

async function runFilePage() {
  const params = new URLSearchParams(location.search);
  const repo = params.get('repo') ?? '';
  const commit = params.get('commit') ?? '';
  const path = params.get('path') ?? '';

  if (!repo || !path) {
    showError('repo와 path 파라미터가 필요합니다.');
    return;
  }

  document.title = `${path} — codebase-analysis`;
  $('#file-path').textContent = path;
  $('#file-meta').textContent = `repo: ${repo}${commit ? ` · ${commit.slice(0, 7)}` : ''}`;
  $('#file-symbols').innerHTML = '<li class="loading">loading…</li>';

  try {
    const { symbols } = await apiGet(
      `/v1/repos/${encodeURIComponent(repo)}/file-symbols?${qs({ path, commit })}`
    );
    renderFileSymbols(symbols, { repo, commit });
  } catch (e) {
    $('#file-symbols').innerHTML = '';
    showError(e.message);
  }
}

function renderFileSymbols(symbols, ctx) {
  const ul = $('#file-symbols');
  if (!symbols.length) {
    ul.innerHTML = '<li class="empty">no symbols found</li>';
    return;
  }
  ul.innerHTML = symbols.map((s) => `
    <li>
      <a href="/s/${s.symbol_key}?${qs(ctx)}">
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="kind">${escapeHtml(s.kind)}</span>
        <span class="loc">:${s.start_line}</span>
      </a>
    </li>`).join('');
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const p = location.pathname;
if (p === '/' || p.endsWith('/index.html')) {
  runSearchPage();
} else if (p.startsWith('/s/')) {
  runSymbolPage();
} else if (p === '/f') {
  runFilePage();
}
