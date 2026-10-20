const topbar = document.getElementById('top');
const view = document.getElementById('view');
const app = document.getElementById('app');
const addform = document.getElementById('addform');
const newItem = document.getElementById('newitem');

// ---- accounts and sync ----
// Lists live on the server, one private document per Google account. localStorage keeps a copy per account so the app opens
// instantly and keeps working offline; edits made offline are flagged and pushed as soon as the network is back.
const CACHE_PREFIX = 'lists.v2.';
const LAST_USER = 'lists.lastUser';
let config = null; // { clientId, gsiSrc } from the server
let user = null; // { email, name } once signed in
let lists = [];
let updatedAt = 0; // server timestamp of the copy we last saw
let dirty = false; // local edits not yet on the server
let syncTimer = null;
let syncing = false;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) throw Object.assign(new Error('Signed out'), { signedOut: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const cacheKey = () => CACHE_PREFIX + user.email;
function readCache(email) {
  try {
    const d = JSON.parse(localStorage.getItem(CACHE_PREFIX + email));
    if (d && Array.isArray(d.lists)) return d;
  } catch {}
  return null;
}
function writeCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ lists, updatedAt, dirty })); } catch {}
}

// Called after every edit: write the local copy now, push to the server shortly (batching quick edits).
function save() {
  if (!user) return;
  dirty = true;
  writeCache();
  scheduleSync();
}
function scheduleSync(delay = 700) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}
async function sync() {
  if (!dirty || syncing || !user) return;
  syncing = true;
  const snapshot = JSON.stringify(lists);
  try {
    const r = await api('PUT', '/api/lists', { lists });
    updatedAt = r.updatedAt;
    if (JSON.stringify(lists) === snapshot) dirty = false; else scheduleSync(0); // edited while saving
    writeCache();
  } catch (err) {
    if (err.signedOut) { syncing = false; return showSignedOut('Your session ended. Please sign in again.'); }
    scheduleSync(15000); // offline or server hiccup: try again later
  }
  syncing = false;
}
// Pick up changes made on another device when the app comes back to the front (never while typing or with unsaved edits).
async function refresh() {
  if (!user || dirty || syncing || document.activeElement?.tagName === 'INPUT') return;
  try {
    const d = await api('GET', '/api/lists');
    if (d.updatedAt > updatedAt && !dirty) { lists = d.lists; updatedAt = d.updatedAt; writeCache(); route(); }
  } catch (err) { if (err.signedOut) showSignedOut('Your session ended. Please sign in again.'); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); else sync(); });
window.addEventListener('online', () => { sync(); refresh(); });
window.addEventListener('pagehide', sync);

function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
function setMenu() {
  window.pwaMenuItems = user ? [
    { html: `<div class="acct"><span class="avatar"><span class="avatar-initial">${escapeHtml((user.name || user.email || '?').trim().charAt(0).toUpperCase())}</span>${user.picture ? `<img src="${escapeHtml(user.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><span>Signed in as<br><b>${escapeHtml(user.email)}</b></span></div>` },
    { label: 'Sign out', onClick: signOut, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><path d="M21 12H9"/></svg>' },
  ] : [];
  if (window.pwaRenderMenu) window.pwaRenderMenu();
}

async function signOut() {
  if (dirty) await sync(); // don't lose edits that haven't reached the server
  try { await api('POST', '/api/auth/logout'); } catch {}
  try { localStorage.removeItem(cacheKey()); localStorage.removeItem(LAST_USER); } catch {}
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showSignedOut();
}

// Starts the app for a signed-in user: server copy first, falling back to the local copy when offline or holding unsynced edits.
async function start(who) {
  user = who;
  try { localStorage.setItem(LAST_USER, JSON.stringify(who)); } catch {}
  const cached = readCache(who.email);
  if (cached && cached.dirty) {
    lists = cached.lists; updatedAt = cached.updatedAt; dirty = true;
    scheduleSync(0);
  } else {
    try {
      const d = await api('GET', '/api/lists');
      lists = d.lists; updatedAt = d.updatedAt; dirty = false;
      writeCache();
    } catch (err) {
      if (err.signedOut || !cached) throw err;
      lists = cached.lists; updatedAt = cached.updatedAt; dirty = false; // offline: show the last copy we have
    }
  }
  setMenu();
  route();
}

let gsiLoading = null;
function loadGoogle() {
  gsiLoading = gsiLoading || new Promise((ok, fail) => {
    const s = el('script', { src: config.gsiSrc, async: true });
    s.onload = ok;
    s.onerror = () => { gsiLoading = null; fail(new Error('Could not load Google sign-in. Check your connection and reload.')); };
    document.head.append(s);
  });
  return gsiLoading;
}
function signinError(text) { const e = document.getElementById('signin-err'); if (e) e.textContent = text; }

function showSignedOut(message) {
  user = null; lists = []; current = null; dirty = false; clearTimeout(syncTimer);
  setMenu();
  document.title = 'Lists';
  app.classList.remove('has-add');
  topbar.replaceChildren(el('h1', { textContent: 'Lists' }));
  view.replaceChildren(el('div', { className: 'empty signin' },
    el('div', { className: 'empty-title', textContent: 'Welcome' }),
    el('p', { textContent: 'Sign in with Google to keep your lists safe and see them on all your devices. Your lists are private to your account.' }),
    el('div', { id: 'gbtn' }),
    el('p', { id: 'signin-err', className: 'signin-err', textContent: message || '' })));
  if (!config) { signinError('Could not reach the server. Check your connection and reload.'); return; }
  loadGoogle().then(() => {
    google.accounts.id.initialize({
      client_id: config.clientId,
      ux_mode: 'popup',
      callback: async (resp) => {
        signinError('');
        try {
          const r = await api('POST', '/api/auth/google', { credential: resp.credential });
          await start(r.user);
        } catch { signinError('Sign-in failed. Please try again.'); }
      },
    });
    google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
  }).catch((err) => signinError(err.message));
}

async function boot() {
  try { config = await (await fetch('/api/config')).json(); } catch { config = null; }
  try {
    await start((await api('GET', '/api/me')).user);
  } catch (err) {
    if (err.signedOut) return showSignedOut();
    // No network: open the last signed-in account from this device's copy, if there is one.
    try {
      const last = JSON.parse(localStorage.getItem(LAST_USER));
      if (last && readCache(last.email)) return await start(last);
    } catch {}
    showSignedOut('You appear to be offline. Connect to sign in.');
  }
}

// Each list gets one of a few theme colours, picked from its id so it never changes.
const COLORS = ['#1a73e8', '#4a6cf0', '#6c58f5', '#7c4dff']; // stops along the theme's blue-to-violet gradient
const colorOf = (list) => COLORS[[...list.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLORS.length];
const uid = () => Math.random().toString(36).slice(2, 10);

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
function btn(className, text, label, onClick) {
  const b = el('button', { className, textContent: text, type: 'button' });
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

// Outline trash can in the current text colour, so it matches the other round buttons.
function trashBtn(onClick) {
  const b = btn('iconbtn trash', '', 'Delete list', onClick);
  b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  return b;
}

// Themed replacement for the browser's confirm(): resolves true if the user taps Delete.
function confirmDelete(message) {
  return new Promise((resolve) => {
    const cancel = el('button', { className: 'dlg-btn', type: 'button', textContent: 'Cancel', value: 'cancel' });
    const ok = el('button', { className: 'dlg-btn danger', type: 'submit', textContent: 'Delete', value: 'ok' });
    const dlg = el('dialog', { className: 'confirm' },
      el('form', { method: 'dialog' },
        el('div', { className: 'dlg-title', textContent: 'Delete this list?' }),
        el('p', { textContent: message }),
        el('div', { className: 'dlg-actions' }, cancel, ok)));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'ok'); });
    cancel.addEventListener('click', () => dlg.close('cancel'));
    ok.addEventListener('click', () => dlg.close('ok'));
    document.body.append(dlg);
    dlg.showModal();
    cancel.focus(); // the safe choice is the default
  });
}

// Two screens on one page, switched by the URL hash: "" = all lists, "#/<id>" = one list.
// Using the hash makes the phone's back button/gesture return to the lists.
let current = null; // the list being shown, or null on the home screen

function route() {
  if (!user) return;
  // A list that was opened but never named or filled (e.g. "New list" then back) is dropped.
  if (current && !current.name.trim() && !current.items.length) {
    lists = lists.filter((l) => l !== current);
    save();
  }
  const id = location.hash.replace(/^#\//, '');
  current = lists.find((l) => l.id === id) || null;
  if (id && !current) { location.replace('#'); return; }
  if (current) showList(); else showHome();
  window.scrollTo(0, 0);
}

function showHome() {
  document.title = 'Lists';
  app.classList.remove('has-add');
  topbar.replaceChildren(
    el('h1', { textContent: 'Lists' }),
    btn('iconbtn plus', '＋', 'New list', () => {
      const list = { id: uid(), name: '', items: [] };
      lists.unshift(list);
      save();
      location.hash = '#/' + list.id;
    }));

  view.replaceChildren(el('div', { id: 'cards' }));
  const cards = view.firstChild;
  if (!lists.length) {
    view.replaceChildren(el('div', { className: 'empty' },
      el('div', { className: 'empty-title', textContent: 'No lists yet' }),
      el('p', {}, 'Tap ', el('span', { className: 'empty-plus', textContent: '＋' }), ' at the top to start your first list')));
    return;
  }
  for (const list of lists) cards.append(card(list));
}

function card(list) {
  const done = list.items.filter((i) => i.done).length;
  const peek = el('div', { className: 'peek' });
  for (const item of list.items.slice(0, 3)) peek.append(el('div', { className: item.done ? 'done' : '', textContent: item.text }));
  if (list.items.length > 3) peek.append(el('div', { className: 'more', textContent: `+ ${list.items.length - 3} more` }));
  return el('a', { className: 'card', href: '#/' + list.id, style: `--c: ${colorOf(list)}` },
    el('div', { className: 'card-top' },
      el('span', { className: 'card-name', textContent: list.name || 'Untitled' }),
      el('span', { className: 'card-count', textContent: list.items.length ? `${done}/${list.items.length}` : 'empty' })),
    list.items.length ? peek : '');
}

function showList() {
  const list = current;
  document.title = list.name || 'Lists';
  app.style.setProperty('--c', colorOf(list));
  app.classList.add('has-add');

  const title = el('input', { className: 'title', value: list.name, placeholder: 'List name', maxLength: 80, enterKeyHint: 'done' });
  title.setAttribute('aria-label', 'List name');
  title.addEventListener('input', () => { list.name = title.value; document.title = list.name || 'Lists'; save(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { title.blur(); newItem.focus(); } });

  topbar.replaceChildren(
    btn('iconbtn', '←', 'Back to lists', () => { location.hash = ''; }),
    title,
    trashBtn(async () => {
      const n = list.items.length;
      if (n && !await confirmDelete(`"${list.name || 'Untitled'}" and its ${n} item${n > 1 ? 's' : ''} will be removed.`)) return;
      lists = lists.filter((l) => l !== list);
      save();
      location.hash = '';
    }));

  // The add row sits right under the last item (not fixed to the screen), so while typing the newest item is always just above it.
  rows = el('div', { id: 'rows' });
  view.replaceChildren(el('div', { id: 'items' }, rows, addform));
  renderItems();
  if (!list.name) title.focus(); // a brand-new list asks for its name first
}

// Re-render only on add/check/remove; typing into an item just saves, so the keyboard stays up.
let rows = null; // the container for the current list's item rows
function renderItems() {
  rows.replaceChildren(...current.items.map(row));
}

function row(item) {
  const list = current;
  const box = el('input', { type: 'checkbox', checked: item.done });
  box.setAttribute('aria-label', 'Done');
  box.addEventListener('change', () => { item.done = box.checked; save(); renderItems(); });

  const text = el('input', { className: 'text', value: item.text, maxLength: 200, enterKeyHint: 'done' });
  text.setAttribute('aria-label', 'Item');
  text.addEventListener('input', () => { item.text = text.value; save(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.blur(); });
  // Clearing an item's text and leaving it removes the item.
  text.addEventListener('blur', () => {
    if (text.value.trim() || !list.items.includes(item)) return;
    list.items = list.items.filter((i) => i !== item);
    save(); renderItems();
  });

  const x = btn('x', '✕', 'Remove item', () => {
    list.items = list.items.filter((i) => i !== item);
    save(); renderItems();
  });

  return el('div', { className: 'item' + (item.done ? ' done' : '') }, box, text, x);
}

addform.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = newItem.value.trim();
  if (!text || !current) return;
  current.items.push({ id: uid(), text, done: false });
  newItem.value = '';
  save(); renderItems();
  newItem.focus();
  // Flash the new item and keep it, with the add row below it, in view.
  rows.lastElementChild.classList.add('added');
  requestAnimationFrame(() => newItem.scrollIntoView({ block: 'center', behavior: 'smooth' }));
});

window.addEventListener('hashchange', route);
boot();
