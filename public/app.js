const KEY = 'lists.v1';
const topbar = document.getElementById('top');
const view = document.getElementById('view');
const app = document.getElementById('app');
const addform = document.getElementById('addform');
const newItem = document.getElementById('newitem');

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(data)) return data;
  } catch {}
  return [];
}
let lists = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch {}
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

// Two screens on one page, switched by the URL hash: "" = all lists, "#/<id>" = one list.
// Using the hash makes the phone's back button/gesture return to the lists.
let current = null; // the list being shown, or null on the home screen

function route() {
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
    trashBtn(() => {
      const n = list.items.length;
      if (n && !confirm(`Delete "${list.name || 'Untitled'}" and its ${n} item${n > 1 ? 's' : ''}?`)) return;
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
route();
