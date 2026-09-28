// Study Autopilot dashboard v2. No build step; data comes from /api/sync, quizzes from /api/quiz.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const KEY        = 'sa.key';
const HOURS      = 'sa.hours';
const BANK       = 'sa.quizBank';
const FLAGGED    = 'sa.flagged';   // Set<id>
const ORDER      = 'sa.order';     // {id: priority_index}
const DONE       = 'sa.done';      // Set<id> — manually marked complete
const STATUS_KEY = 'sa.status';    // {id: 'todo'|'in-progress'|'done'}
const TASKS_KEY  = 'sa.tasks';     // custom manually-added tasks []

function loadFlagged() { return new Set(store.get(FLAGGED, [])); }
function saveFlagged(s) { store.set(FLAGGED, [...s]); }
function loadOrder() { return store.get(ORDER, {}); }
function saveOrder(o) { store.set(ORDER, o); }
function loadDone() { return new Set(store.get(DONE, [])); }
function saveDone(s) { store.set(DONE, [...s]); }
function loadStatus() { return store.get(STATUS_KEY, {}); }
function saveStatus(m) { store.set(STATUS_KEY, m); }
function loadCustomTasks() { return store.get(TASKS_KEY, []); }
function saveCustomTasks(arr) { store.set(TASKS_KEY, arr); }

/** Get the current 3-state status of an item. */
function getItemStatus(it) {
  if (it.submitted) return 'done';
  if (loadDone().has(it.id)) return 'done';
  return loadStatus()[it.id] || 'todo';
}

/** Persist a new status; syncs the legacy DONE set for backward compat. */
function setItemStatus(id, val) {
  const statuses = loadStatus();
  statuses[id] = val;
  saveStatus(statuses);
  const done = loadDone();
  if (val === 'done') done.add(id); else done.delete(id);
  saveDone(done);
}

// ---------- confetti ----------
const CONFETTI_COLORS = ['#7c6ff7','#f26b6b','#54c98f','#f0a050','#46cac2','#b98fff','#ff9fd4'];
function fireConfetti(anchor) {
  const rect = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const angle = (i / 20) * 360 + Math.random() * 18 - 9;
    const dist = 44 + Math.random() * 40;
    const tx = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
    const ty = Math.round(Math.sin((angle * Math.PI) / 180) * dist - 20);
    const delay = Math.random() * 0.08;
    el.style.cssText = [
      `position:fixed`,
      `left:${cx - 3.5}px`,
      `top:${cy - 3.5}px`,
      `background:${color}`,
      `--cx:${tx}px`,
      `--cr:${Math.round(Math.random()*360)}deg`,
      `animation-delay:${delay.toFixed(3)}s`,
      `z-index:9999`,
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`,
    ].join(';');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    // override cy with spread
    el.style.top = `${cy - 3.5 + ty * 0}px`;
    el.style.setProperty('--cx', `${tx}px`);
  }
}

// ---------- school week ----------
function schoolWeek(semesterStart) {
  if (!semesterStart) return null;
  const start = new Date(semesterStart + 'T00:00:00');
  const now = new Date();
  const week = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return week >= 1 && week <= 26 ? week : null;
}

// ---------- timezone ----------
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- dates ----------
const fmt = (iso, opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso));
const dayName = (date) => fmt(`${date}T12:00:00Z`, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (iso) => fmt(iso, { hour: 'numeric', minute: '2-digit' });
const dueText = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const localDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function relDue(iso) {
  const days = Math.round((new Date(`${localDate(new Date(iso))}T12:00:00Z`) - new Date(`${localDate()}T12:00:00Z`)) / 864e5);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 0) return `${-days}d overdue`;
  return `in ${days}d`;
}

// ---------- API ----------
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'x-access-key': store.get(KEY, ''), ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (r.status === 401) { showGate("That key didn't work. Try again."); throw new Error('locked'); }
  if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
  return body;
}

// ---------- gate ----------
function showGate(errMsg) {
  $('#gate').hidden = false;
  $('#tab-today').hidden = true;
  $('#tab-week').hidden = true;
  $('#tab-all').hidden = true;
  $('#tab-quiz').hidden = true;
  if (errMsg) { $('#gateError').textContent = errMsg; $('#gateError').hidden = false; }
}
function hideGate() {
  $('#gate').hidden = true;
  $('#gateError').hidden = true;
}

// ---------- course cleanup ----------
/*  "FA26_PSY110.03" -> "PSY 110"   "Introduction to Psychology" -> unchanged */
function cleanCourse(raw) {
  let s = String(raw || '');
  s = s.replace(/^[A-Z]{2}\d{2}_/, '');
  s = s.replace(/[.\-_]\d{2,3}$/, '');
  s = s.replace(/([A-Za-z]{2,})(\d)/, '$1 $2');
  return s.trim();
}

// ---------- urgency ----------
function urgencyTier(it, today) {
  const daysUntilDue = Math.round((new Date(it.dueAt) - new Date(`${today}T12:00:00`)) / 864e5);
  if (localDate(new Date(it.dueAt)) === today) return 0;
  if (it.sessions.some((s) => s.date === today)) return 1;
  if (it.atRisk && daysUntilDue <= 3) return 2;
  if (it.atRisk) return 3;
  return 4;
}

function urgencyBadge(tier, it) {
  if (tier === 0) return '<span class="ubadge due-today">Due today</span>';
  if (tier === 1) return '<span class="ubadge study-today">Study today</span>';
  if (tier === 2) return `<span class="ubadge at-risk">At risk · ${it.shortHours > 0 ? `${it.shortHours}h won't fit` : 'tight'}</span>`;
  const atRiskMsg = it.shortHours > 0
    ? `<span class="risk">At risk · ${it.shortHours}h won't fit before the due date</span>`
    : '<span class="risk">At risk · only fits by using your buffer day</span>';
  if (tier === 3) return `<span class="ubadge behind">Behind schedule</span>${atRiskMsg}`;
  return '<span class="ubadge starts-today">Starts today</span>';
}

// ---------- helpers ----------
function titleLink(it) {
  return it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
}

// ---------- TODAY tab ----------
function renderToday(plan) {
  const today = localDate();
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const days = [today, tomorrow, dayAfter];
  const dayLabels = ['Today', 'Tomorrow', dayName(dayAfter).split(', ')[0]];
  const items = plan.items || [];
  const flagged = loadFlagged();

  const itemsForDay = (d) => items
    .filter((it) => !it.submitted && localDate(new Date(it.dueAt)) === d)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  const cols = days.map((d, i) => {
    const due = itemsForDay(d);
    const isToday = d === today;

    return `
      <div class="today-col${isToday ? ' is-today' : ''}">
        <div class="today-col-head">
          <h3>${dayLabels[i]}</h3>
          ${due.length ? `<span class="col-count">${due.length}</span>` : ''}
        </div>
        <div class="today-cards">
          ${due.length ? due.map((it) => kanbanCard(it, flagged)).join('') : '<p class="today-empty">Nothing due.</p>'}
        </div>
      </div>`;
  });

  $('#tab-today').innerHTML = `<div class="today-kanban">${cols.join('')}</div>`;

  // Click delegation for Today tab — status select + flag
  $('#tab-today').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel) return;
    setItemStatus(sel.dataset.id, sel.value);
    const card = sel.closest('.kanban-card');
    if (sel.value === 'done' && card) {
      fireConfetti(card);
      card.style.transition = 'opacity 0.25s, transform 0.22s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.93) translateY(-4px)';
      setTimeout(() => renderToday(plan), 260);
    }
  });
  $('#tab-today').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="flag"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const fl = loadFlagged();
    fl.has(id) ? fl.delete(id) : fl.add(id);
    saveFlagged(fl);
    renderToday(plan);
  });
}

// ---------- WEEK tab ----------
function renderWeek(plan) {
  const today = localDate();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const flagged = loadFlagged();

  const label = (d) => {
    if (d === today) return 'Today';
    if (d === addDays(today, 1)) return 'Tomorrow';
    return dayName(d).split(',')[0]; // "Mon", "Tue", etc.
  };
  const sublabel = (d) => {
    const parts = dayName(d).split(', ');
    return parts.slice(1).join(', ') || dayName(d); // "Sep 28"
  };

  const cols = days.map((d) => {
    const due = (plan.items || [])
      .filter((it) => !it.submitted && localDate(new Date(it.dueAt)) === d)
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    const isToday = d === today;

    return `
      <div class="today-col${isToday ? ' is-today' : ''}">
        <div class="today-col-head">
          <div>
            <h3>${label(d)}</h3>
            <div class="week-sublabel">${sublabel(d)}</div>
          </div>
          ${due.length ? `<span class="col-count">${due.length}</span>` : ''}
        </div>
        <div class="today-cards">
          ${due.length ? due.map((it) => kanbanCard(it, flagged)).join('') : '<p class="today-empty">Free</p>'}
        </div>
      </div>`;
  });

  $('#tab-week').innerHTML = `<div class="today-kanban week-kanban">${cols.join('')}</div>`;

  // Interactions — status + flag
  $('#tab-week').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel) return;
    setItemStatus(sel.dataset.id, sel.value);
    if (sel.value === 'done') {
      const card = sel.closest('.kanban-card');
      if (card) {
        fireConfetti(card);
        card.style.transition = 'opacity 0.25s, transform 0.22s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.93) translateY(-4px)';
        setTimeout(() => renderWeek(plan), 260);
      }
    }
  });
  $('#tab-week').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="flag"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const fl = loadFlagged();
    fl.has(id) ? fl.delete(id) : fl.add(id);
    saveFlagged(fl);
    renderWeek(plan);
  });
}

// ---------- ALL tab — filters + date-grouped view ----------

// Filter state persists while the app is open
const filters = { due: 'all', courses: new Set(), types: new Set() };

const TYPE_LABELS = {
  exam: 'Exam', quiz: 'Quiz', essay: 'Essay', project: 'Project',
  reading: 'Reading', discussion: 'Discussion', homework: 'Homework',
};

function applyFilters(items, today) {
  return items.filter((it) => {
    if (filters.due !== 'all') {
      if (!it.dueAt) return false;
      const dLocal = localDate(new Date(it.dueAt));
      if (filters.due === 'today' && dLocal !== today) return false;
      if (filters.due === 'tomorrow' && dLocal !== addDays(today, 1)) return false;
      if (filters.due === 'week') {
        const d = Math.round((new Date(`${dLocal}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 864e5);
        if (d < 0 || d > 7) return false;
      }
      if (filters.due === 'next2w') {
        const d = Math.round((new Date(`${dLocal}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 864e5);
        if (d < 0 || d > 14) return false;
      }
    }
    if (filters.courses.size > 0 && !filters.courses.has(cleanCourse(it.course))) return false;
    if (filters.types.size > 0 && !filters.types.has(it.type)) return false;
    return true;
  });
}

function activeFilterCount() {
  let n = 0;
  if (filters.due !== 'all') n++;
  n += filters.courses.size;
  n += filters.types.size;
  return n;
}

function filterBar(plan) {
  const items = allItems(plan);
  const courses = [...new Set(items.map((i) => cleanCourse(i.course)).filter(Boolean))].sort();
  const types = [...new Set(items.map((i) => i.type).filter(Boolean))].sort();

  const dueOpts = [
    { val: 'all', label: 'All time' },
    { val: 'today', label: 'Due today' },
    { val: 'tomorrow', label: 'Due tomorrow' },
    { val: 'week', label: 'This week' },
    { val: 'next2w', label: 'Next 2 weeks' },
  ];

  const chip = (group, val, label, active) =>
    `<button class="fchip${active ? ' active' : ''}" data-group="${group}" data-val="${esc(val)}" type="button">${esc(label)}</button>`;

  const hasActive = activeFilterCount() > 0;

  return `
    <div class="filter-bar" id="filterBar">
      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">Due</span>
          ${dueOpts.map((o) => chip('due', o.val, o.label, filters.due === o.val)).join('')}
        </div>
        ${courses.length > 1 ? `
        <div class="filter-group">
          <span class="filter-label">Class</span>
          ${courses.map((c) => chip('course', c, c, filters.courses.has(c))).join('')}
        </div>` : ''}
        ${types.length > 0 ? `
        <div class="filter-group">
          <span class="filter-label">Type</span>
          ${types.map((t) => chip('type', t, TYPE_LABELS[t] || t, filters.types.has(t))).join('')}
        </div>` : ''}
        ${hasActive ? `<button class="fchip clear-filters" id="clearFilters" type="button">✕ Clear filters</button>` : ''}
      </div>
    </div>`;
}

/** Build an assignment card for the date-grouped view. */
function kanbanCard(it, flagged) {
  const today = localDate();
  const tier = urgencyTier(it, today);
  const isFlagged = flagged.has(it.id);
  const status = getItemStatus(it);
  const isDone = status === 'done';
  const classes = ['kanban-card',
    it.atRisk && !isDone ? 'is-risk' : '',
    isFlagged ? 'is-flagged' : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="${classes}" data-id="${esc(it.id)}">
      <button class="flag-btn" data-action="flag" data-id="${esc(it.id)}"
        title="${isFlagged ? 'Unflag' : 'Flag as important'}" type="button">${isFlagged ? '★' : '☆'}</button>
      <div class="course-row">
        <span class="course">${esc(cleanCourse(it.course))}</span>
        ${it.type && TYPE_LABELS[it.type] ? `<span class="chip k-${it.type}">${TYPE_LABELS[it.type]}</span>` : ''}
      </div>
      <div class="title">${titleLink(it)}</div>
      <div class="meta-row">
        <span class="meta">${esc(dueText(it.dueAt))}</span>
        ${it.hoursLeft ?? it.hours ? `<span class="meta">${it.hoursLeft ?? it.hours}h</span>` : ''}
        ${tier <= 2 && !isDone ? urgencyBadge(tier, it) : ''}
      </div>
      <select class="status-select" data-action="status" data-id="${esc(it.id)}" aria-label="Status">
        <option value="todo"${status === 'todo' ? ' selected' : ''}>To Do</option>
        <option value="in-progress"${status === 'in-progress' ? ' selected' : ''}>In Progress</option>
        <option value="done"${status === 'done' ? ' selected' : ''}>Done</option>
      </select>
      ${it.isCustom ? `<button class="delete-task-btn" data-action="delete-task" data-id="${esc(it.id)}" title="Remove task" type="button">✕</button>` : ''}
    </div>`;
}

/** Render the date-grouped assignment view inside #dateBoard. */
function renderDateView(plan) {
  const today = localDate();
  const items = allItems(plan);
  const flagged = loadFlagged();

  const filtered = applyFilters(items, today);
  const activeItems = filtered.filter((it) => getItemStatus(it) !== 'done');
  const doneItems   = filtered.filter((it) => getItemStatus(it) === 'done');

  // Partition active items into overdue and future date buckets
  const overdueItems = [];
  const byDate = new Map();
  activeItems.forEach((it) => {
    const dLocal = localDate(new Date(it.dueAt));
    const diff = Math.round((new Date(`${dLocal}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 864e5);
    if (diff < 0) {
      overdueItems.push(it);
    } else {
      if (!byDate.has(dLocal)) byDate.set(dLocal, []);
      byDate.get(dLocal).push(it);
    }
  });

  // Sort within each group: flagged first, then chronological
  const sortGroup = (arr) => [...arr].sort((a, b) => {
    const fa = flagged.has(a.id) ? 0 : 1;
    const fb = flagged.has(b.id) ? 0 : 1;
    return fa - fb || new Date(a.dueAt) - new Date(b.dueAt);
  });

  const groupHeadInner = (label, count) =>
    `<span class="date-label">${label}</span><span class="date-count">${count}</span>`;

  const dateLabelStr = (d) => {
    if (d === today) return 'Today';
    if (d === addDays(today, 1)) return 'Tomorrow';
    return fmt(`${d}T12:00:00Z`, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  const cardsGrid = (its) =>
    `<div class="date-cards">${sortGroup(its).map((it) => kanbanCard(it, flagged)).join('')}</div>`;

  let html = '';

  if (overdueItems.length) {
    html += `
      <div class="date-group is-overdue">
        <div class="date-group-head">${groupHeadInner('Overdue', overdueItems.length)}</div>
        ${cardsGrid(overdueItems)}
      </div>`;
  }

  [...byDate.keys()].sort().forEach((d) => {
    const cls = d === today ? ' is-today' : '';
    html += `
      <div class="date-group${cls}">
        <div class="date-group-head">${groupHeadInner(dateLabelStr(d), byDate.get(d).length)}</div>
        ${cardsGrid(byDate.get(d))}
      </div>`;
  });

  if (doneItems.length) {
    const sortedDone = [...doneItems].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    html += `
      <details class="date-group done-group">
        <summary class="date-group-head">${groupHeadInner('Done / Submitted', doneItems.length)}</summary>
        ${cardsGrid(sortedDone)}
      </details>`;
  }

  if (!html) {
    const msg = activeFilterCount() > 0
      ? 'No matches — try adjusting filters.'
      : 'Nothing to show yet. Sync with Canvas to load your assignments.';
    html = `<p class="kanban-empty">${msg}</p>`;
  }

  document.getElementById('dateBoard').innerHTML = html;
}

/** Merge plan items with custom tasks for the All tab. */
function allItems(plan) {
  const planItems = plan.items || [];
  const custom = loadCustomTasks();
  if (!custom.length) return planItems;
  // Give custom tasks minimal plan-compatible shape
  const shaped = custom.map((t) => ({
    id: t.id, course: t.course || 'Custom', title: t.title,
    dueAt: t.dueAt, points: t.points || null, type: t.type || 'homework',
    description: '', url: null, submitted: false,
    hours: t.hours || 1, hoursLeft: t.hours || 1,
    sessions: [], atRisk: false, isCustom: true,
  }));
  return [...planItems, ...shaped].sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  });
}

/** Show the Add Task modal. */
function showAddTaskModal(plan) {
  const courses = [...new Set(allItems(plan).map((i) => cleanCourse(i.course)).filter(Boolean))].sort();
  const existing = document.getElementById('add-task-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'add-task-modal';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box">
      <div class="modal-head">
        <h2>Add task</h2>
        <button class="btn ghost small" id="closeModal" type="button" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <label class="field-label">Title <span class="req">*</span></label>
        <input id="nt-title" type="text" placeholder="e.g. Read Chapter 6" autocomplete="off">
        <label class="field-label">Class</label>
        <div class="class-row">
          <select id="nt-course-sel">
            <option value="">— choose a class —</option>
            ${courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            <option value="__custom__">+ Type a new class name</option>
          </select>
          <input id="nt-course-txt" type="text" placeholder="Class name" style="display:none">
        </div>
        <div class="field-row">
          <div>
            <label class="field-label">Type</label>
            <select id="nt-type">
              <option value="homework">Homework</option>
              <option value="reading">Reading</option>
              <option value="quiz">Quiz</option>
              <option value="exam">Exam</option>
              <option value="essay">Essay</option>
              <option value="project">Project</option>
              <option value="discussion">Discussion</option>
            </select>
          </div>
          <div>
            <label class="field-label">Due date</label>
            <input id="nt-due" type="date">
          </div>
          <div>
            <label class="field-label">Est. hours</label>
            <input id="nt-hours" type="number" min="0.5" max="40" step="0.5" value="1" style="width:80px">
          </div>
        </div>
        <p id="nt-msg" class="muted small" aria-live="polite"></p>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" id="cancelModal" type="button">Cancel</button>
        <button class="btn" id="saveTask" type="button">Add task</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Set default due date to tomorrow
  const tomorrow = addDays(localDate(), 1);
  document.getElementById('nt-due').value = tomorrow;

  const close = () => modal.remove();
  document.getElementById('closeModal').addEventListener('click', close);
  document.getElementById('cancelModal').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', close);

  // Class selector toggle
  document.getElementById('nt-course-sel').addEventListener('change', (e) => {
    const txt = document.getElementById('nt-course-txt');
    if (e.target.value === '__custom__') { txt.style.display = ''; txt.focus(); }
    else { txt.style.display = 'none'; txt.value = ''; }
  });

  document.getElementById('saveTask').addEventListener('click', () => {
    const title = document.getElementById('nt-title').value.trim();
    const courseSel = document.getElementById('nt-course-sel').value;
    const courseTxt = document.getElementById('nt-course-txt').value.trim();
    const course = courseSel === '__custom__' ? courseTxt : courseSel;
    const type = document.getElementById('nt-type').value;
    const dueDate = document.getElementById('nt-due').value;
    const hours = parseFloat(document.getElementById('nt-hours').value) || 1;
    const msg = document.getElementById('nt-msg');

    if (!title) { msg.textContent = 'Please enter a title.'; return; }
    if (!dueDate) { msg.textContent = 'Please pick a due date.'; return; }

    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const dueAt = new Date(`${dueDate}T23:59:00`).toISOString();
    const tasks = loadCustomTasks();
    tasks.push({ id, course: course || 'Custom', title, type, dueAt, hours });
    saveCustomTasks(tasks);
    close();
    renderAll(plan);
  });
}

function renderAll(plan) {
  const addBtn = `<button class="btn ghost small" id="addTaskBtn" type="button" style="margin-left:auto">+ Add task</button>`;
  $('#tab-all').innerHTML = `${filterBar(plan)}<div class="all-header">${addBtn}</div><div id="dateBoard"></div>`;
  renderDateView(plan);

  // Add task button
  const addTaskBtn = document.getElementById('addTaskBtn');
  if (addTaskBtn) addTaskBtn.addEventListener('click', () => showAddTaskModal(plan));

  // Click delegation — filter chips and flag buttons
  $('#tab-all').addEventListener('click', (e) => {
    // Add task from delegation (in case button re-rendered)
    if (e.target.closest('#addTaskBtn')) { showAddTaskModal(plan); return; }

    // Delete custom task
    const delBtn = e.target.closest('[data-action="delete-task"]');
    if (delBtn) {
      const id = delBtn.dataset.id;
      const tasks = loadCustomTasks().filter((t) => t.id !== id);
      saveCustomTasks(tasks);
      renderDateView(plan);
      return;
    }

    const chip = e.target.closest('.fchip');
    if (chip) {
      if (chip.id === 'clearFilters') {
        filters.due = 'all'; filters.courses.clear(); filters.types.clear();
      } else {
        const { group, val } = chip.dataset;
        if (group === 'due') { filters.due = val; }
        else if (group === 'course') { filters.courses.has(val) ? filters.courses.delete(val) : filters.courses.add(val); }
        else if (group === 'type') { filters.types.has(val) ? filters.types.delete(val) : filters.types.add(val); }
      }
      $('#tab-all').innerHTML = `${filterBar(plan)}<div id="dateBoard"></div>`;
      renderDateView(plan);
      return;
    }

    const flagBtn = e.target.closest('[data-action="flag"]');
    if (flagBtn) {
      const id = flagBtn.dataset.id;
      const f = loadFlagged();
      if (f.has(id)) f.delete(id); else f.add(id);
      saveFlagged(f);
      renderDateView(plan);
      return;
    }
  });

  // Status dropdown change
  $('#tab-all').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel) return;
    const id = sel.dataset.id;
    const val = sel.value;
    setItemStatus(id, val);
    if (val === 'done') {
      const card = sel.closest('.kanban-card');
      if (card) {
        fireConfetti(card);
        card.style.transition = 'opacity 0.28s, transform 0.22s';
        card.style.opacity = '0';
        card.style.transform = 'translateY(-4px) scale(0.95)';
        setTimeout(() => renderDateView(plan), 300);
        return;
      }
    }
    renderDateView(plan);
  });
}

// ---------- QUIZ tab ----------
const PROMPT_TEXT = `Please generate a study quiz from the attached material.

Return ONLY a JSON array of exactly 10 question objects. No other text. Each object:
{
  "type": "mc" | "short" | "explain",
  "q": "question text",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],  // mc only
  "answer": "correct answer or key points",
  "why": "1-3 sentence explanation of why the answer is right",
  "source": "page or section reference (optional)"
}

Mix: 5 multiple-choice, 3 short-answer, 2 explain/apply.`;

function loadBank() { return store.get(BANK, []); }
function saveBank(b) { store.set(BANK, b); }

function nextReview(bank) {
  const today = localDate();
  return bank.filter((q) => q.nextReview && q.nextReview <= today);
}

function renderBankList() {
  const bank = loadBank();
  const today = localDate();
  const due = nextReview(bank);
  const badge = $('#reviewBadge');
  if (due.length) { badge.textContent = due.length; badge.hidden = false; } else { badge.hidden = true; }

  const groups = {};
  bank.forEach((q) => { (groups[q.topic || 'Untitled'] = groups[q.topic || 'Untitled'] || []).push(q); });

  $('#bank').innerHTML = Object.entries(groups).map(([t, qs]) => {
    const dueNow = qs.filter((q) => q.nextReview && q.nextReview <= today).length;
    const next = qs.map((q) => q.nextReview).filter(Boolean).sort()[0];
    return `<li class="row between wrap"><span><b>${esc(t)}</b> <span class="muted small">${qs.length} questions · ${dueNow ? `${dueNow} due now` : `next ${esc(dayName(next))}`}</span></span></li>`;
  }).join('') || '<p class="muted small">No saved questions yet.</p>';
}

// ---------- quiz runner ----------
function startQuiz(questions, topic) {
  const runner = $('#quizRunner');
  const home = $('#quizHome');
  home.hidden = true;
  runner.hidden = false;

  let idx = 0;
  let score = 0;

  function showQ() {
    if (idx >= questions.length) {
      runner.innerHTML = `
        <div class="card">
          <h2>Done! ${score}/${questions.length} correct</h2>
          <button class="btn" id="quit" type="button">Back</button>
        </div>`;
      $('#quit').addEventListener('click', () => { runner.hidden = true; home.hidden = false; renderBankList(); });
      return;
    }
    const q = questions[idx];
    const typeLabel = q.type === 'mc' ? 'Multiple choice' : q.type === 'short' ? 'Short answer' : 'Explain';

    runner.innerHTML = `
      <div class="card quiz-card">
        <div class="row between"><span class="muted small">${esc(topic || 'Quiz')} · ${idx + 1} of ${questions.length} · ${typeLabel}</span><button class="btn small ghost" id="quit" type="button">Quit</button></div>
        <h2 class="q-text">${esc(q.q)}</h2>
        ${q.type === 'mc' && q.options
          ? `<ul class="options">${q.options.map((o, i) => `<li><button class="option-btn" data-i="${i}" type="button">${esc(o)}</button></li>`).join('')}</ul>`
          : `<textarea id="shortAns" rows="3" placeholder="Your answer..."></textarea>
             <button class="btn" id="checkAns" type="button">Check</button>`}
        <div id="feedback" hidden></div>
      </div>`;

    $('#quit').addEventListener('click', () => {
      runner.hidden = true;
      home.hidden = false;
      renderBankList();
    });

    if (q.type === 'mc') {
      runner.querySelectorAll('.option-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const correct = q.answer && btn.textContent.trim().startsWith(q.answer.trim().charAt(0));
          if (correct) score++;
          showFeedback(correct, q);
        });
      });
    } else {
      $('#checkAns')?.addEventListener('click', () => { showFeedback(null, q); });
    }
  }

  function showFeedback(correct, q) {
    const fb = $('#feedback');
    fb.hidden = false;
    fb.innerHTML = `
      <div class="answer-block">
        ${correct !== null ? `<span class="${correct ? 'correct' : 'wrong'}">${correct ? 'Correct!' : 'Not quite.'}</span>` : ''}
        <p><b>Answer:</b> ${esc(q.answer || '')}</p>
        ${q.why ? `<p>${esc(q.why)}</p>` : ''}
        ${q.source ? `<p class="muted small">Source: ${esc(q.source)}</p>` : ''}
      </div>
      ${correct !== null
        ? `<div class="row gap"><button class="btn" id="gotIt" type="button">I got it</button><button class="btn ghost" id="missed" type="button">I missed it</button></div>`
        : '<button class="btn" id="next" type="button">Next</button>'}`;

    const advance = (got) => {
      if (got) score++;
      idx++;
      showQ();
    };

    $('#gotIt')?.addEventListener('click', () => advance(true));
    $('#missed')?.addEventListener('click', () => advance(false));
    $('#next')?.addEventListener('click', () => { idx++; showQ(); });
  }

  showQ();
}

// ---------- import quiz from paste ----------
function parseQuiz(raw) {
  const text = raw.trim();
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const useArr = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj);
  const start = useArr ? firstArr : firstObj;
  const end = useArr ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error("I couldn't find the quiz in what you pasted. Copy Claude's whole reply, including the { } brackets.");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The pasted quiz looks cut off or edited. Copy Claude's reply again with the copy button under its message.");
  }
  const qs = Array.isArray(parsed) ? parsed : parsed.questions || parsed.quiz || Object.values(parsed)[0];
  if (!Array.isArray(qs) || !qs.length) throw new Error('No questions found. Make sure you paste the full reply.');
  return qs;
}

// ---------- make quiz via API ----------
async function makeQuiz(file, text, topic, msg) {
  msg.textContent = 'Reading the material and writing questions… this takes 20–60 seconds.';
  const form = new FormData();
  if (file) form.append('file', file);
  if (text) form.append('text', text);
  if (topic) form.append('topic', topic);
  const data = await api('/api/quiz', { method: 'POST', body: form });
  const qs = data.questions || data;
  if (!Array.isArray(qs) || !qs.length) throw new Error('No questions returned. Try again.');
  return qs;
}

// ---------- spaced repetition ----------
function scheduleReview(bank, qs, topic) {
  const today = localDate();
  const intervals = [1, 3, 7, 14];
  qs.forEach((q) => {
    const existing = bank.findIndex((b) => b.q === q.q && b.topic === topic);
    const entry = { ...q, topic: topic || 'Untitled', nextReview: today, streak: 0, intervals };
    if (existing >= 0) bank[existing] = entry;
    else bank.push(entry);
  });
  return bank;
}

// ---------- tabs ----------
function activateTab(name) {
  document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
}

// ---------- sync ----------
let lastPlan = null;

async function sync() {
  $('#status').textContent = 'Syncing with Canvas…';
  try {
    const data = await api('/api/sync');
    lastPlan = data.plan;
    const synced = new Date(data.plan?.generatedAt);
    const week = schoolWeek(data.config?.semesterStart);
    const weekLabel = week ? `Week ${week} · ` : '';
    $('#status').textContent = `${weekLabel}Synced ${fmt(synced.toISOString(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${data.source === 'api' ? 'Canvas API' : 'Canvas calendar feed'}`;
    renderToday(data.plan);
    renderWeek(data.plan);
    renderAll(data.plan);
    hideGate();
  } catch (err) {
    if (err.message === 'locked') return;
    $('#error').textContent = err.message;
    $('#error').hidden = false;
  }
}

// ---------- boot ----------
async function boot() {
  $('#promptText').textContent = PROMPT_TEXT;
  renderBankList();

  const key = store.get(KEY, '');
  if (!key) { showGate(); return; }
  await sync();
}

// ---------- event wiring ----------
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('#keyInput').value.trim();
  if (!key) return;
  store.set(KEY, key);
  await sync();
});

$('#refresh').addEventListener('click', sync);

// ---------- theme toggle ----------
const THEME_KEY = 'sa.theme';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('#themeToggle .theme-icon');
  if (icon) icon.textContent = theme === 'light' ? '☾' : '☀︎';
  store.set(THEME_KEY, theme);
}
applyTheme(store.get(THEME_KEY, 'dark'));

$('#themeToggle').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

$('#lock').addEventListener('click', () => {
  store.del(KEY);
  lastPlan = null;
  showGate();
  ['#tab-today', '#tab-week', '#tab-all'].forEach((s) => { $(s).innerHTML = ''; });
});

document.querySelectorAll('[role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

$('#copyPrompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(PROMPT_TEXT);
    $('#copyMsg').textContent = 'Copied!';
    setTimeout(() => { $('#copyMsg').textContent = ''; }, 2000);
  } catch {
    $('#copyMsg').textContent = 'Select the prompt below and copy it manually.';
  }
});

$('#importQuiz').addEventListener('click', () => {
  const msg = $('#pasteMsg');
  const raw = $('#pasteQuiz').value;
  const topic = $('#pasteTopic').value.trim();
  if (!raw) { msg.textContent = "Paste Claude's reply first."; return; }
  try {
    const qs = parseQuiz(raw);
    let bank = loadBank();
    bank = scheduleReview(bank, qs, topic);
    saveBank(bank);
    $('#pasteQuiz').value = '';
    msg.textContent = `Saved ${qs.length} questions!`;
    renderBankList();
    startQuiz(qs, topic);
  } catch (err) {
    msg.textContent = err.message;
  }
});

$('#startReview').addEventListener('click', () => {
  const bank = loadBank();
  const due = nextReview(bank);
  if (!due.length) { alert('No questions due for review yet.'); return; }
  startQuiz(due, 'Review');
});

// file drop
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) { $('#quizFile').files = e.dataTransfer.files; $('#dropText').textContent = file.name; }
});
$('#quizFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    if (file.size > 3 * 1024 * 1024) {
      $('#quizMsg').textContent = `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is about 3 MB — split the PDF into chapters or upload a photo of the key pages.`;
      $('#quizFile').value = '';
      return;
    }
    $('#dropText').textContent = file.name;
  }
});

$('#makeQuiz').addEventListener('click', async () => {
  const msg = $('#quizMsg');
  const file = $('#quizFile').files[0];
  const text = $('#quizText').value.trim();
  const topic = $('#quizTopic').value.trim();
  if (!file && !text) { msg.textContent = 'Add a file or paste some text first.'; return; }
  try {
    msg.textContent = 'Working…';
    const qs = await makeQuiz(file, text, topic, msg);
    let bank = loadBank();
    bank = scheduleReview(bank, qs, topic);
    saveBank(bank);
    msg.textContent = `Saved ${qs.length} questions!`;
    renderBankList();
    startQuiz(qs, topic);
  } catch (err) {
    msg.textContent = err.message;
  }
});

boot();
