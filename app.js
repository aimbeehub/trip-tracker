// Study Autopilot dashboard v2. No build step; data comes from /api/sync, quizzes from /api/quiz.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const KEY = 'sa.key';
const HOURS = 'sa.hours';
const BANK = 'sa.quizBank';
const FLAGGED = 'sa.flagged';   // Set<id>
const ORDER = 'sa.order';       // {id: priority_index}
const DONE = 'sa.done';         // Set<id> — manually marked complete

function loadFlagged() { return new Set(store.get(FLAGGED, [])); }
function saveFlagged(s) { store.set(FLAGGED, [...s]); }
function loadOrder() { return store.get(ORDER, {}); }
function saveOrder(o) { store.set(ORDER, o); }
function loadDone() { return new Set(store.get(DONE, [])); }
function saveDone(s) { store.set(DONE, [...s]); }

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
  // Insert space between letter run and digit run: PSY110 -> PSY 110
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

// ---------- TODAY tab (3-column kanban) ----------
function renderToday(plan) {
  const today = localDate();
  const items = plan.items || [];

  // Column 1: Due Today
  const dueToday = items
    .filter((it) => !it.submitted && localDate(new Date(it.dueAt)) === today)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  // Column 2: Today's study blocks
  const blocks = (plan.blocks || []).filter((b) => b.date === today);

  // Column 3: On deck — at-risk or starts today, not due today
  const onDeck = items
    .filter((it) => {
      if (it.submitted) return false;
      if (localDate(new Date(it.dueAt)) === today) return false;
      const tier = urgencyTier(it, today);
      return tier <= 3; // study-today, at-risk tight, behind
    })
    .sort((a, b) => urgencyTier(a, today) - urgencyTier(b, today) || new Date(a.dueAt) - new Date(b.dueAt))
    .slice(0, 8); // cap at 8 to keep column scannable

  const tCard = (it) => {
    const tier = urgencyTier(it, today);
    return `
      <div class="t-card${tier === 0 ? ' urgent' : ''}">
        <div class="t-course">${esc(cleanCourse(it.course))}</div>
        <div class="t-title">${titleLink(it)}</div>
        <div class="t-due">Due ${esc(time(it.dueAt))} &middot; ${it.hoursLeft ?? it.hours ?? 0}h</div>
        ${tier >= 2 ? `<div class="t-badge">${urgencyBadge(tier, it)}</div>` : ''}
      </div>`;
  };

  const blockCard = (b) => `
    <div class="block-row${b.n === 1 ? ' is-start' : ''}">
      <div class="block-time">${time(b.start)}<br>${time(b.end)}</div>
      <div class="block-body">
        <div class="b-label">${b.n === 1 ? "Start — " : ""}${esc(b.label)}</div>
        <div class="b-meta">${esc(cleanCourse(b.course))} &middot; ${b.hours}h</div>
      </div>
    </div>`;

  const col1 = `
    <div class="today-col">
      <div class="today-col-head">
        <span class="col-dot red"></span>
        <h3>Due Today</h3>
        <span class="col-count">${dueToday.length}</span>
      </div>
      <div class="today-cards">
        ${dueToday.length ? dueToday.map(tCard).join('') : '<p class="today-empty">Nothing due today.</p>'}
      </div>
    </div>`;

  const col2 = `
    <div class="today-col">
      <div class="today-col-head">
        <span class="col-dot blue"></span>
        <h3>Study Today</h3>
        <span class="col-count">${blocks.length}</span>
      </div>
      <div class="today-cards">
        ${blocks.length
          ? blocks.map(blockCard).join('')
          : '<p class="today-empty">No blocks yet. Add study windows in <code>config.json</code>.</p>'}
      </div>
    </div>`;

  const col3 = `
    <div class="today-col">
      <div class="today-col-head">
        <span class="col-dot amber"></span>
        <h3>On Deck</h3>
        <span class="col-count">${onDeck.length}</span>
      </div>
      <div class="today-cards">
        ${onDeck.length ? onDeck.map(tCard).join('') : '<p class="today-empty">You\'re all caught up.</p>'}
      </div>
    </div>`;

  $('#tab-today').innerHTML = `<div class="today-kanban">${col1}${col2}${col3}</div>`;
}

// ---------- WEEK tab ----------
function renderWeek(plan) {
  const today = localDate();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const html = days.map((d) => {
    const blocks = (plan.blocks || []).filter((b) => b.date === d);
    const due = (plan.items || []).filter((i) => localDate(new Date(i.dueAt)) === d);
    const total = blocks.reduce((s, b) => s + (b.hours || 0), 0);

    const blockHtml = (b) => `
      <li class="block-item">
        <div class="when">${time(b.start)}<span>–${time(b.end)}</span></div>
        <div>
          <div class="title">${b.n === 1 ? '<b>START</b> · ' : ''}${esc(b.label)} <span class="muted">(${b.n}/${b.of})</span></div>
          <div class="meta">${esc(cleanCourse(b.course))} — ${esc(b.title)} · ${b.hours}h</div>
        </div>
      </li>`;

    return `
      <div class="day-block${d === today ? ' today' : ''}">
        <div class="day-head">
          <b>${d === today ? 'Today' : esc(dayName(d).split(',')[0])}</b>
          <span class="muted">${esc(dayName(d).split(', ').slice(1).join(', ') || dayName(d))}</span>
          ${total ? `<span class="hrs">${total}h</span>` : ''}
        </div>
        ${due.length ? `<div class="due-pills">${due.map((i) => `<span class="due-pill${d === today ? ' urgent' : ''}">${esc(cleanCourse(i.course))} — ${esc(i.title)}</span>`).join('')}</div>` : ''}
        ${blocks.length ? `<ul class="blocks">${blocks.map(blockHtml).join('')}</ul>` : '<p class="muted small">Free</p>'}
      </div>`;
  }).join('');

  $('#tab-week').innerHTML = `<div class="week">${html}</div>`;
}

// ---------- ALL tab — filters + kanban ----------

// Filter state persists while the app is open
const filters = { due: 'all', courses: new Set(), types: new Set() };

const TYPE_LABELS = {
  exam: 'Exam', quiz: 'Quiz', essay: 'Essay', project: 'Project',
  reading: 'Reading', discussion: 'Discussion', homework: 'Homework',
};

function applyFilters(items, today) {
  return items.filter((it) => {
    // Due date
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
    // Course
    if (filters.courses.size > 0 && !filters.courses.has(cleanCourse(it.course))) return false;
    // Type
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
  const today = localDate();
  const items = plan.items || [];
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

function kanbanCard(it, flagged, done) {
  const today = localDate();
  const tier = urgencyTier(it, today);
  const isFlagged = flagged.has(it.id);
  const isDone = done.has(it.id) || it.submitted;
  const classes = ['kanban-card', it.atRisk ? 'is-risk' : '', isFlagged ? 'is-flagged' : ''].filter(Boolean).join(' ');
  return `
    <div class="${classes}" draggable="true" data-id="${esc(it.id)}">
      <button class="flag-btn" data-action="flag" data-id="${esc(it.id)}" title="${isFlagged ? 'Unflag' : 'Flag as important'}" type="button">${isFlagged ? '★' : '☆'}</button>
      <div class="course-row">
        <span class="course">${esc(cleanCourse(it.course))}</span>
        ${it.type && TYPE_LABELS[it.type] ? `<span class="chip k-${it.type}">${TYPE_LABELS[it.type]}</span>` : ''}
      </div>
      <div class="title">${titleLink(it)}</div>
      <div class="meta-row">
        <span class="meta">${esc(dueText(it.dueAt))}</span>
        ${it.hoursLeft ?? it.hours ? `<span class="meta">${it.hoursLeft ?? it.hours}h</span>` : ''}
        ${tier <= 2 ? urgencyBadge(tier, it) : ''}
      </div>
      ${!isDone ? `<button class="btn ghost small" style="margin-top:7px;font-size:11px;" data-action="done" data-id="${esc(it.id)}" type="button">✓ Mark done</button>` : ''}
    </div>`;
}

function sortByPriority(items, flagged, order) {
  return [...items].sort((a, b) => {
    const fa = flagged.has(a.id) ? 0 : 1;
    const fb = flagged.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const oa = order[a.id] ?? 9999;
    const ob = order[b.id] ?? 9999;
    if (oa !== ob) return oa - ob;
    return new Date(a.dueAt) - new Date(b.dueAt);
  });
}

function renderKanban(plan) {
  const today = localDate();
  const items = plan.items || [];
  const flagged = loadFlagged();
  const order = loadOrder();
  const done = loadDone();

  const filtered = applyFilters(items, today);
  const active = filtered.filter((i) => !i.submitted && !done.has(i.id));
  const submitted = filtered.filter((i) => i.submitted || done.has(i.id));

  const inProgress = active.filter((i) => i.sessions && i.sessions.some((s) => s.date <= today && s.date >= addDays(today, -7)));
  const toDo = active.filter((i) => !inProgress.includes(i));

  const emptyMsg = activeFilterCount() > 0 ? 'No matches — try adjusting filters.' : null;

  const col = (title, dot, cardItems, emptyFallback, colId, extraClass = '') => `
    <div class="kanban-col${extraClass}" data-col="${colId}">
      <div class="kanban-head">
        <span class="col-dot ${dot}"></span>
        <h3>${title}</h3>
        <span class="kanban-count">${cardItems.length}</span>
      </div>
      <div class="kanban-cards" data-col="${colId}">
        ${cardItems.length
          ? sortByPriority(cardItems, flagged, order).map((it) => kanbanCard(it, flagged, done)).join('')
          : `<p class="kanban-empty">${emptyMsg || emptyFallback}</p>`}
      </div>
    </div>`;

  document.getElementById('kanbanBoard').innerHTML = `
    <div class="kanban">
      ${col('In Progress', 'blue', inProgress, 'Nothing started yet.', 'progress')}
      ${col('To Do', 'amber', toDo, 'Nothing upcoming.', 'todo')}
      ${col('Submitted', 'ok', submitted, 'Nothing submitted yet.', 'done', ' col-done')}
    </div>`;

  // ---- Drag-to-reorder ----
  let draggingId = null;
  const board = document.getElementById('kanbanBoard');

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card[data-id]');
    if (!card) return;
    draggingId = card.dataset.id;
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card[data-id]');
    if (card) card.classList.remove('dragging');
    board.querySelectorAll('.kanban-cards').forEach((c) => c.classList.remove('drag-over'));
    draggingId = null;
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    const col = e.target.closest('.kanban-cards');
    if (col) col.classList.add('drag-over');
  });

  board.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.kanban-cards');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });

  board.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggingId) return;
    const targetCol = e.target.closest('.kanban-cards');
    if (!targetCol) return;
    targetCol.classList.remove('drag-over');

    // Determine new position: cards in the target column, in DOM order
    const cards = [...targetCol.querySelectorAll('.kanban-card[data-id]')];
    const dropTarget = e.target.closest('.kanban-card[data-id]');
    let newIndex = cards.length;
    if (dropTarget && dropTarget.dataset.id !== draggingId) {
      newIndex = cards.indexOf(dropTarget);
    }

    // Rebuild order for this column with dragged card at new position
    const ord = loadOrder();
    const colIds = cards.map((c) => c.dataset.id).filter((id) => id !== draggingId);
    colIds.splice(newIndex, 0, draggingId);
    colIds.forEach((id, i) => { ord[id] = i; });
    saveOrder(ord);
    renderKanban(plan);
  });
}

function renderAll(plan) {
  $('#tab-all').innerHTML = `${filterBar(plan)}<div id="kanbanBoard"></div>`;
  renderKanban(plan);

  // Event delegation for all interactive elements in the tab
  $('#tab-all').addEventListener('click', (e) => {
    // Filter chips
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
      $('#tab-all').innerHTML = `${filterBar(plan)}<div id="kanbanBoard"></div>`;
      renderKanban(plan);
      return;
    }

    // Flag button
    const flagBtn = e.target.closest('[data-action="flag"]');
    if (flagBtn) {
      const id = flagBtn.dataset.id;
      const f = loadFlagged();
      if (f.has(id)) f.delete(id); else f.add(id);
      saveFlagged(f);
      renderKanban(plan);
      return;
    }

    // Mark done button
    const doneBtn = e.target.closest('[data-action="done"]');
    if (doneBtn) {
      const id = doneBtn.dataset.id;
      const d = loadDone();
      d.add(id);
      saveDone(d);
      renderKanban(plan);
    }
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
    const entry = {
      ...q,
      topic: topic || 'Untitled',
      nextReview: today,
      streak: 0,
      intervals,
    };
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
    $('#status').textContent = `Synced ${fmt(synced.toISOString(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${data.source === 'api' ? 'Canvas API' : 'Canvas calendar feed'}`;
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
