const STORAGE_KEY = 'babybox.kids';

// Box number: [first month inclusive, last month exclusive]
const SCHEDULE = [
  { n: 1, from: 0, to: 4, label: '0–3 mois' },
  { n: 2, from: 4, to: 7, label: '4–6 mois' },
  { n: 3, from: 7, to: 9, label: '7–8 mois' },
  { n: 4, from: 9, to: 11, label: '9–10 mois' },
  { n: 5, from: 11, to: 13, label: '11–12 mois' },
];

const SETS = {
  L: { color: '#f2c230', text: '#3d2e00', name: 'jaune' },
  A: { color: '#ef8022', text: '#3d1c00', name: 'orange' },
};
const DEFAULT_SET = 'L';

const MONTHS_VISIBLE = 12;
const MONTHS_AHEAD = 12;
const MIN_PX_PER_DAY = 2.2;
const DAY_MS = 86400000;

const el = {
  scroller: document.getElementById('scroller'),
  months: document.getElementById('months'),
  rows: document.getElementById('rows'),
  empty: document.getElementById('empty'),
  legend: document.getElementById('legend'),
  sets: document.getElementById('sets'),
  setHint: document.getElementById('set-hint'),
  dialog: document.getElementById('kid-dialog'),
  form: document.getElementById('kid-form'),
  name: document.getElementById('kid-name'),
  dob: document.getElementById('kid-dob'),
  set: document.getElementById('kid-set'),
  swatch: document.getElementById('set-swatch'),
  error: document.getElementById('form-error'),
  title: document.getElementById('dialog-title'),
  submit: document.getElementById('submit-btn'),
  del: document.getElementById('delete-btn'),
};

let kids = load();
let editingId = null;
let view = null; // current render scale, used to keep the view anchored on the same date

sortKids();

/* ---------- dates ---------- */

// Anchoring at noon keeps DST shifts from moving a date to another day.
const at = (y, m, d) => new Date(y, m, d, 12);

const startOfMonth = (d) => at(d.getFullYear(), d.getMonth(), 1);

function addMonths(date, months) {
  const y = date.getFullYear();
  const m = date.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate(); // clamp: Jan 31 + 1 month -> Feb 28
  return at(y, m, Math.min(date.getDate(), lastDay));
}

const daysBetween = (a, b) => (b - a) / DAY_MS;

function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return at(y, m - 1, d);
}

const pad = (n) => String(n).padStart(2, '0');

// DD/MM/YYYY -> YYYY-MM-DD, null if that date does not exist
function toIso(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [d, mo, y] = m.slice(1).map(Number);
  const date = at(y, mo - 1, d);
  if (date.getDate() !== d || date.getMonth() !== mo - 1 || date.getFullYear() !== y) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function toDayFirst(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/* ---------- data ---------- */

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((k) => k && k.name && k.dob).map((k) => ({ ...k, set: normalizeSet(k.set) }));
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kids));
}

// ISO dates sort lexicographically, so this is chronological
function sortKids() {
  kids.sort((a, b) => a.dob.localeCompare(b.dob) || a.name.localeCompare(b.name, 'fr'));
}

function normalizeSet(value) {
  const letter = String(value ?? '').trim().toUpperCase();
  return letter in SETS ? letter : DEFAULT_SET;
}

function boxesFor(kid) {
  const dob = parseDate(kid.dob);
  return SCHEDULE.map((s) => ({
    ...s,
    code: `${kid.set}${s.n}`,
    start: addMonths(dob, s.from),
    end: addMonths(dob, s.to),
  }));
}

/* ---------- rendering ---------- */

function render() {
  el.empty.hidden = kids.length > 0;

  const today = new Date();
  const defaultStart = startOfMonth(addMonths(today, -1));
  let rangeStart = defaultStart;
  let rangeEnd = startOfMonth(addMonths(today, MONTHS_AHEAD + 1));

  // widen the range so that every box of every kid fits in it
  for (const kid of kids) {
    const boxes = boxesFor(kid);
    const first = startOfMonth(boxes[0].start);
    const last = startOfMonth(addMonths(boxes.at(-1).end, 1));
    if (first < rangeStart) rangeStart = first;
    if (last > rangeEnd) rangeEnd = last;
  }

  const totalDays = daysBetween(rangeStart, rangeEnd);
  const available = el.scroller.clientWidth - cssPx('--name-col');
  const yearDays = daysBetween(rangeStart, addMonths(rangeStart, MONTHS_VISIBLE));
  const pxPerDay = Math.max(available / yearDays, MIN_PX_PER_DAY);
  const trackWidth = totalDays * pxPerDay;
  const x = (date) => daysBetween(rangeStart, date) * pxPerDay;

  // date currently at the left edge, restored after the re-render
  const anchor = view
    ? new Date(view.rangeStart.getTime() + (el.scroller.scrollLeft / view.pxPerDay) * DAY_MS)
    : defaultStart;

  renderMonths(rangeStart, rangeEnd, pxPerDay, today, x);
  renderRows(rangeStart, rangeEnd, trackWidth, today, x);
  renderLegend();

  view = { rangeStart, pxPerDay };
  el.scroller.scrollLeft = Math.max(x(anchor), 0);
}

function cssPx(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

function monthList(rangeStart, rangeEnd) {
  const months = [];
  for (let m = new Date(rangeStart); m < rangeEnd; m = addMonths(m, 1)) {
    months.push({ start: new Date(m), end: addMonths(m, 1) });
  }
  return months;
}

function renderMonths(rangeStart, rangeEnd, pxPerDay, today, x) {
  el.months.replaceChildren();

  const spacer = document.createElement('div');
  spacer.className = 'name-cell';
  el.months.append(spacer);

  for (const m of monthList(rangeStart, rangeEnd)) {
    const width = daysBetween(m.start, m.end) * pxPerDay;
    const cell = document.createElement('div');
    cell.className = 'month' + (m.start.getMonth() === 0 ? ' january' : '');
    cell.style.width = `${width}px`;
    const label = fmtMonth.format(m.start).replace('.', '');
    cell.textContent = width < 34 ? label.slice(0, 1).toUpperCase() : `${label} ${String(m.start.getFullYear()).slice(2)}`;
    cell.title = `${label} ${m.start.getFullYear()}`;
    el.months.append(cell);
  }

  el.months.append(todayLine(rangeStart, rangeEnd, today, x, cssPx('--name-col')));
}

function todayLine(rangeStart, rangeEnd, today, x, offset = 0) {
  if (today < rangeStart || today >= rangeEnd) return document.createComment('');
  const line = document.createElement('div');
  line.className = 'today-line';
  line.style.left = `${x(today) + offset}px`;
  return line;
}

function renderRows(rangeStart, rangeEnd, trackWidth, today, x) {
  el.rows.replaceChildren();

  for (const kid of kids) {
    const { color, text } = SETS[kid.set];

    const row = document.createElement('div');
    row.className = 'row';

    const nameCell = document.createElement('div');
    nameCell.className = 'name-cell';
    nameCell.tabIndex = 0;
    nameCell.title = 'Modifier';
    nameCell.innerHTML = '<span class="kid-name"><span class="set-tag"></span><span class="label"></span></span><span class="kid-dob"></span>';
    const tag = nameCell.querySelector('.set-tag');
    tag.textContent = kid.set;
    tag.style.background = color;
    tag.style.color = text;
    nameCell.querySelector('.label').textContent = kid.name;
    nameCell.querySelector('.kid-dob').textContent = `né(e) le ${fmtDate.format(parseDate(kid.dob))}`;
    nameCell.addEventListener('click', () => openDialog(kid));
    nameCell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDialog(kid); }
    });

    const track = document.createElement('div');
    track.className = 'track';
    track.style.width = `${trackWidth}px`;

    for (const m of monthList(rangeStart, rangeEnd)) {
      const line = document.createElement('div');
      line.className = 'month-line' + (m.start.getMonth() === 0 ? ' january' : '');
      line.style.left = `${x(m.start)}px`;
      track.append(line);
    }

    for (const box of boxesFor(kid)) {
      if (box.end <= rangeStart || box.start >= rangeEnd) continue;
      const left = x(box.start);
      const width = x(box.end) - left;
      const div = document.createElement('div');
      div.className = 'box';
      div.style.left = `${left}px`;
      div.style.width = `${Math.max(width - 2, 8)}px`;
      div.style.background = color;
      div.style.color = text;
      div.textContent = box.code;
      div.title = `${kid.name} — ${box.code} (${box.label})\n${fmtDate.format(box.start)} → ${fmtDate.format(new Date(box.end - DAY_MS))}`;
      track.append(div);
    }

    track.append(todayLine(rangeStart, rangeEnd, today, x));
    row.append(nameCell, track);
    el.rows.append(row);
  }
}

function renderLegend() {
  el.legend.replaceChildren();
  for (const s of SCHEDULE) {
    const li = document.createElement('li');
    li.textContent = `Box ${s.n} : ${s.label}`;
    el.legend.append(li);
  }

  el.sets.replaceChildren();
  for (const [letter, { color, name }] of Object.entries(SETS)) {
    const names = kids.filter((k) => k.set === letter).map((k) => k.name).join(', ');
    const li = document.createElement('li');
    li.innerHTML = '<span class="swatch"></span><span></span>';
    li.firstElementChild.style.background = color;
    li.lastElementChild.textContent = `Série ${letter} (${name})${names ? ` — ${names}` : ''}`;
    el.sets.append(li);
  }
}

/* ---------- form ---------- */

function openDialog(kid = null) {
  editingId = kid ? kid.id : null;
  el.title.textContent = kid ? 'Modifier un enfant' : 'Ajouter un enfant';
  el.submit.textContent = kid ? 'Enregistrer' : 'Ajouter';
  el.del.hidden = !kid;
  el.name.value = kid ? kid.name : '';
  el.dob.value = kid ? toDayFirst(kid.dob) : '';
  el.set.value = kid ? kid.set : DEFAULT_SET;
  el.error.hidden = true;
  updateSwatch();
  el.dialog.showModal();
  el.name.focus();
}

function updateSwatch() {
  const { color, name } = SETS[normalizeSet(el.set.value)];
  el.swatch.style.background = color;
  el.setHint.textContent = name;
}

el.set.addEventListener('change', updateSwatch);

// insert the slashes while typing, but not while deleting
el.dob.addEventListener('input', (e) => {
  const digits = el.dob.value.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  const trailing = !e.inputType?.startsWith('delete') && (digits.length === 2 || digits.length === 4);
  el.dob.value = parts.join('/') + (trailing ? '/' : '');
});

el.form.addEventListener('submit', (e) => {
  const name = el.name.value.trim();
  const dob = toIso(el.dob.value);
  const set = normalizeSet(el.set.value);

  if (!name || !dob) {
    e.preventDefault();
    el.error.textContent = 'Merci de saisir un prénom et une date de naissance au format JJ/MM/AAAA.';
    el.error.hidden = false;
    return;
  }

  if (editingId) {
    Object.assign(kids.find((k) => k.id === editingId), { name, dob, set });
  } else {
    kids.push({ id: crypto.randomUUID(), name, dob, set });
  }

  sortKids();
  save();
  render();
});

el.del.addEventListener('click', () => {
  const kid = kids.find((k) => k.id === editingId);
  if (!kid || !confirm(`Supprimer ${kid.name} du calendrier ?`)) return;
  kids = kids.filter((k) => k.id !== editingId);
  save();
  render();
  el.dialog.close();
});

document.getElementById('cancel-btn').addEventListener('click', () => el.dialog.close());
document.getElementById('add-btn').addEventListener('click', () => openDialog());

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

render();
