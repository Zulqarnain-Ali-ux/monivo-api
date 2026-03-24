/**
 * MONIVO Frontend API Client
 * ─────────────────────────────────────────────────────────────────
 * Drop this script block into MONIVO.html, replacing the _M / S
 * memory storage layer. Every function maps 1:1 to a backend route.
 *
 * Usage: include this before the main app script, then swap every
 * S.s() / S.g() call for the async equivalents below.
 */

const API_BASE = '/api/v1';

// ── Core fetch wrapper ────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',          // sends httpOnly cookies automatically
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (res.status === 401) {
    // Try token refresh once, then redirect to sign-in
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiFetch(path, options); // retry original request
    }
    clearLocalCache();
    gp('landing');
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `API error ${res.status}`);
  }

  if (res.status === 204) return null;
  const json = await res.json();
  return json.data ?? json;          // unwrap { data, meta } envelope
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST', credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Local cache (in-memory, populated from API on login) ──────────
const _cache = {
  user:    null,
  income:  null,
  budget:  null,   // array of BudgetCategory objects
  streak:  null,
  goals:   [],
  entries: [],     // last 90 days — populated on login, updated optimistically
};

function clearLocalCache() {
  _cache.user = null; _cache.income = null; _cache.budget = null;
  _cache.streak = null; _cache.goals = []; _cache.entries = [];
}

// ── Auth ──────────────────────────────────────────────────────────
async function doSignup() {
  const fn  = document.getElementById('su-fn').value.trim();
  const ln  = document.getElementById('su-ln').value.trim();
  const em  = document.getElementById('su-em').value.trim();
  const pw  = document.getElementById('su-pw').value;
  const inc = parseFloat(document.getElementById('su-inc').value) || 0;
  const err = document.getElementById('su-err');

  if (!fn) { err.textContent = 'Please enter your first name.'; err.style.display = 'block'; return; }
  if (!em || !em.includes('@')) { err.textContent = 'Please enter a valid email.'; err.style.display = 'block'; return; }
  err.style.display = 'none';

  try {
    const result = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ fname: fn, lname: ln, email: em, password: pw, income: inc }),
    });
    if (!result) return;
    _cache.user = result.user;

    // Show scan page
    const scanName = document.getElementById('scan-name');
    if (scanName) scanName.textContent = fn;
    const scanInc = document.getElementById('scan-income');
    if (scanInc && inc > 0) { scanInc.value = inc; }

    const scanPage = document.getElementById('page-scan');
    if (scanPage) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      scanPage.style.display = 'flex';
      scanPage.classList.add('active');
      updateScanPreview();
    } else {
      await loadAndEnterApp();
    }
  } catch (e) {
    err.textContent = e.message || 'Sign up failed. Please try again.';
    err.style.display = 'block';
  }
}

async function doSignin() {
  const em  = document.getElementById('si-em').value.trim();
  const pw  = document.getElementById('si-pw').value;
  const err = document.getElementById('si-err');
  err.style.display = 'none';

  try {
    const result = await apiFetch('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: em || 'demo@monivo.ai', password: pw || 'demo' }),
    });
    if (!result) return;
    _cache.user = result.user;
    await loadAndEnterApp();
  } catch (e) {
    err.textContent = e.message || 'Invalid email or password.';
    err.style.display = 'block';
  }
}

async function doSignout() {
  await apiFetch('/auth/signout', { method: 'POST' }).catch(() => {});
  clearLocalCache();
  gp('landing');
}

// ── Bootstrap: load all data then enter app ───────────────────────
async function loadAndEnterApp() {
  try {
    // Load core data in parallel — budget, income, streak, goals, user
    const [user, income, budget, streak, goals] = await Promise.all([
      _cache.user ?? apiFetch('/auth/me'),
      apiFetch('/income'),
      apiFetch('/budget'),
      apiFetch('/streak'),
      apiFetch('/goals'),
    ]);

    _cache.user   = user;
    _cache.income = income;
    _cache.budget = budget;
    _cache.streak = streak;
    _cache.goals  = goals ?? [];

    // Fetch last 90 days of entries for reports — enough for all views
    const now  = new Date();
    const to   = now.toISOString().slice(0, 10);
    const from = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10);
    const entries = await apiFetch('/entries?from=' + from + '&to=' + to);
    _cache.entries = entries ?? [];

    enterApp();
  } catch (e) {
    console.error('Failed to load app data:', e);
  }
}

// ── Entries ────────────────────────────────────────────────────────
async function submitLog() {
  const amount = parseFloat(amtStr);
  if (!amount || amount <= 0) return;
  const category = catVal || 'other';
  const note = document.getElementById('log-note').value.trim();
  const now  = new Date();

  try {
    const entry = await apiFetch('/entries', {
      method: 'POST',
      body: JSON.stringify({
        amount, category, note,
        entryDate: now.toISOString().slice(0, 10),
        entryTs: now.getTime(),
      }),
    });
    if (!entry) return;

    // Optimistic local update
    _cache.entries.unshift(entry);
    _cache.streak = await apiFetch('/streak'); // refresh streak

    // Toast reward (unchanged from original)
    const pool = rewards[category] || rewards.default;
    const line = _cache.entries.filter(e => e.entryDate === now.toISOString().slice(0,10)).length === 1
      ? 'First entry today. People who log their first entry are 3x more likely to still be here next week.'
      : pool[Math.floor(Math.random() * pool.length)](amount.toFixed(2));

    const varDaily = variableDailyAllowance();
    const todayVar = _cache.entries
      .filter(e => e.entryDate === now.toISOString().slice(0,10))
      .filter(e => !['rent','utilities','insurance','car','phone','subscriptions','bank','savings','investments','debt'].includes(e.category))
      .reduce((s, e) => s + Number(e.amount), 0);
    const pct = varDaily > 0 ? todayVar / varDaily : 0;

    let tone = 's', lbl = 'Logged';
    if (pct > 1)  { tone = 'd'; lbl = "Over today's budget"; }
    else if (pct > .8) { tone = 'w'; lbl = 'Getting close'; }

    const toast = document.getElementById('log-toast');
    toast.className = `toast ${tone}`;
    document.getElementById('t-lbl').textContent = lbl;
    document.getElementById('t-msg').textContent = line;
    requestAnimationFrame(() => toast.classList.add('on'));
    if (toastTmr) clearTimeout(toastTmr);
    toastTmr = setTimeout(() => toast.classList.remove('on'), 5000);

    amtStr = ''; catVal = '';
    document.getElementById('amt-val').textContent = '0';
    document.getElementById('log-sub').disabled = true;
    document.getElementById('log-note').value = '';
    document.querySelectorAll('.cp').forEach(p => p.classList.remove('on'));
    refreshDailyAvail();
    refreshToday();
  } catch (e) {
    console.error('Log failed:', e);
  }
}

async function deleteEntry(entryId) {
  await apiFetch(`/entries/${entryId}`, { method: 'DELETE' });
  _cache.entries = _cache.entries.filter(e => e.id !== entryId);
  refreshToday();
}

// Fetch entries for a date range (used by reports)
async function fetchEntries(from, to) {
  const params = new URLSearchParams({ from, to });
  return apiFetch(`/entries?${params}`);
}

// ── Budget ─────────────────────────────────────────────────────────
async function saveCategoryAmount(catId, amount) {
  const updated = await apiFetch(`/budget/categories/${catId}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount }),
  });
  if (updated && _cache.budget) {
    const idx = _cache.budget.findIndex(c => c.catId === catId);
    if (idx !== -1) _cache.budget[idx] = updated;
  }
  refreshBudget();
}

async function setAutopilot(mode) {
  const updated = await apiFetch('/budget/autopilot', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
  if (updated) _cache.budget = updated;
  refreshBudget();
}

// ── Income ─────────────────────────────────────────────────────────
async function saveIncome() {
  const salary  = parseFloat(document.getElementById('inc-salary')?.value)  || 0;
  const side    = parseFloat(document.getElementById('inc-side')?.value)    || 0;
  const passive = parseFloat(document.getElementById('inc-passive')?.value) || 0;
  const savings = parseFloat(document.getElementById('inc-savings')?.value) || 0;
  const invest  = parseFloat(document.getElementById('inc-invest')?.value)  || 0;

  const updated = await apiFetch('/income', {
    method: 'PUT',
    body: JSON.stringify({ salary, side, passive, savingsGoal: savings, investGoal: invest }),
  });
  if (updated) _cache.income = updated;
  refreshBudget();
  refreshToday();
}

// ── Goals ──────────────────────────────────────────────────────────
async function saveGoal(data) {
  if (data.id) {
    const updated = await apiFetch(`/goals/${data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: data.name, target: data.target, saved: data.saved }),
    });
    if (updated) {
      const idx = _cache.goals.findIndex(g => g.id === data.id);
      if (idx !== -1) _cache.goals[idx] = updated;
    }
  } else {
    const created = await apiFetch('/goals', {
      method: 'POST',
      body: JSON.stringify({ name: data.name, target: data.target, saved: data.saved ?? 0, goalType: data.type ?? 'other' }),
    });
    if (created) _cache.goals.push(created);
  }
  renderGoals();
}

async function deleteGoal(id) {
  await apiFetch(`/goals/${id}`, { method: 'DELETE' });
  _cache.goals = _cache.goals.filter(g => g.id !== id);
  renderGoals();
}

// ── Compatibility shims: replace S.g() / S.s() ────────────────────
// These make existing render functions work without modification.
// The cache is the single source of truth after loadAndEnterApp().

function getUser()    { return _cache.user; }
function getIncome()  {
  if (!_cache.income) return { salary: 0, side: 0, passive: 0, savings: 0, invest: 0 };
  return {
    salary:  Number(_cache.income.salary),
    side:    Number(_cache.income.side),
    passive: Number(_cache.income.passive),
    savings: Number(_cache.income.savingsGoal),
    invest:  Number(_cache.income.investGoal),
  };
}
function getBudget()  {
  return {
    income: getTotalIncome(),
    categories: (_cache.budget ?? []).map(c => ({
      id: c.catId, name: c.name, group: c.groupType,
      key: c.catKey, amt: Number(c.amount), icon: c.icon,
    })),
  };
}
function getEntries() { return _cache.entries.map(e => ({
  id: e.id, amount: Number(e.amount), category: e.category,
  date: e.entryDate, ts: e.entryTs, note: e.note ?? '',
})); }
function getStreak()  {
  return _cache.streak ?? { days: 0, lastLog: null, graceUsed: false };
}
function getTotalIncome() {
  const i = getIncome();
  return (i.salary || 0) + (i.side || 0) + (i.passive || 0);
}

// ── Reports: fetch server-side aggregations ────────────────────────
async function fetchReportSummary()  { return apiFetch('/reports/summary'); }
async function fetchMonthlyReport()  { return apiFetch('/reports/monthly?months=6'); }
async function fetchBenchmarks()     { return apiFetch('/reports/benchmarks'); }
async function fetchDailyTotals(from, to) {
  return apiFetch(`/reports/daily?from=${from}&to=${to}`);
}

// ── Plaid bank sync ────────────────────────────────────────────────
async function connectBank() {
  const { linkToken } = await apiFetch('/plaid/link-token', { method: 'POST' });
  if (!linkToken) return;
  // Plaid Link is loaded via <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js">
  const handler = window.Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken) => {
      await apiFetch('/plaid/exchange-token', {
        method: 'POST',
        body: JSON.stringify({ publicToken }),
      });
      // Trigger a sync and reload entries
      const items = await apiFetch('/plaid/items');
      if (items?.length) {
        await apiFetch(`/plaid/sync/${items[0].plaidItemId}`, { method: 'POST' });
        // Reload entries into cache
        _cache.entries = await apiFetch('/entries') ?? [];
        refreshToday();
      }
    },
    onExit: (err) => { if (err) console.error('Plaid exit:', err); },
  });
  handler.open();
}

// ── Demo mode (still works — creates a real account server-side) ───
async function tryDemo() {
  try {
    // Sign in with the seeded demo account (or create it)
    const result = await apiFetch('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: 'demo@monivo.ai', password: 'demo-password' }),
    });
    if (!result) return;
    _cache.user = result.user;
    await loadAndEnterApp();
  } catch {
    // Demo account doesn't exist yet — create it
    const result = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        fname: 'Alex', lname: 'Chen',
        email: 'demo@monivo.ai', password: 'demo-password',
        income: 6200,
      }),
    });
    if (!result) return;
    _cache.user = result.user;
    await loadAndEnterApp();
  }
}
