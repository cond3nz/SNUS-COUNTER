/* Снюс-счётчик — веб-версия.
 * Логика полностью повторяет Android SnusStore.java, хранилище — localStorage. */
"use strict";

// ================= Хранилище (аналог SnusStore.java) =================

const PREFS_KEY = "snus_prefs_v1";

const defaults = {
  entries: [],            // [{t: timestampMs, p: portions}]
  dailyLimit: 10,
  portionsPerPouch: 20,
  nicotineMgPerPortion: 6,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return structuredClone(defaults);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaults), ...parsed };
  } catch {
    return structuredClone(defaults);
  }
}

function save() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(state));
}

// ---------- Утилиты дат ----------
function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartMillis(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------- Операции над записями ----------
function addEntry(portions) {
  state.entries.push({ t: Date.now(), p: Math.max(1, Math.round(portions)) });
  save();
}

function removeLastEntryToday() {
  const today = dayKey(Date.now());
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (dayKey(state.entries[i].t) === today) {
      state.entries.splice(i, 1);
      save();
      return true;
    }
  }
  return false;
}

function clearToday() {
  const today = dayKey(Date.now());
  state.entries = state.entries.filter((e) => dayKey(e.t) !== today);
  save();
}

function clearAll() {
  state.entries = [];
  save();
}

// ---------- Статистика ----------
function getTodayEntries() {
  const today = dayKey(Date.now());
  return state.entries.filter((e) => dayKey(e.t) === today);
}

function getTodayCount() {
  return getTodayEntries().reduce((s, e) => s + e.p, 0);
}

function getLastUseTimeToday() {
  const list = getTodayEntries();
  return list.length ? Math.max(...list.map((e) => e.t)) : 0;
}

/** Дней подряд без использования */
function getCleanDaysStreak() {
  if (!state.entries.length) return 0;
  const latest = Math.max(...state.entries.map((e) => e.t));
  const todayStart = dayStartMillis(Date.now());
  const lastStart = dayStartMillis(latest);
  return Math.round((todayStart - lastStart) / 86400000);
}

/** Группировка по дням: [{key, ts, total}] от старых к новым */
function getDailyTotals() {
  const map = new Map();
  for (const e of state.entries) {
    const k = dayKey(e.t);
    if (!map.has(k)) map.set(k, { key: k, ts: dayStartMillis(e.t), total: 0 });
    map.get(k).total += e.p;
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function getMaxDailyTotal() {
  return getDailyTotals().reduce((m, d) => Math.max(m, d.total), 0);
}

function getAverageDailyTotal() {
  const daily = getDailyTotals();
  if (!daily.length) return 0;
  return daily.reduce((s, d) => s + d.total, 0) / daily.length;
}

// ================= UI =================

const $ = (id) => document.getElementById(id);

const els = {
  todayCount: $("todayCount"),
  progressFill: $("progressFill"),
  progressText: $("progressText"),
  limitWarning: $("limitWarning"),
  lastUseTimer: $("lastUseTimer"),
  cleanStreak: $("cleanStreak"),
  pouchesToday: $("pouchesToday"),
  todayList: $("todayList"),
  todayEmpty: $("todayEmpty"),
  statTotal: $("statTotal"),
  statAvg: $("statAvg"),
  statMax: $("statMax"),
  chart: $("chart"),
  historyList: $("historyList"),
  historyEmpty: $("historyEmpty"),
};

// ---------- Форматтеры ----------
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} сек`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} дн ${h % 24} ч`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(key) {
  const [y, m, d] = key.split("-");
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  if (key === today) return "Сегодня";
  if (key === yesterday) return "Вчера";
  return `${d}.${m}.${y}`;
}

// ---------- Отрисовка главного экрана ----------
function renderToday() {
  const count = getTodayCount();
  const limit = state.dailyLimit;
  const over = count > limit;

  els.todayCount.textContent = count;
  els.todayCount.closest(".counter-value").classList.toggle("over", over);

  const pct = Math.min(100, (count / limit) * 100);
  els.progressFill.style.width = pct + "%";
  els.progressFill.classList.toggle("over", count >= limit);
  els.progressText.textContent = `лимит: ${limit} · сегодня: ${count}`;

  els.limitWarning.classList.toggle("hidden", !over);

  // Банки сегодня
  const pouches = (count / state.portionsPerPouch).toFixed(2).replace(/\.?0+$/, "");
  els.pouchesToday.textContent = pouches;

  // Чистая серия
  els.cleanStreak.textContent = getCleanDaysStreak();

  // Список порций за сегодня (новые сверху)
  const list = getTodayEntries().slice().reverse();
  els.todayList.innerHTML = "";
  for (const e of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="entry-time">${fmtTime(e.t)}</span>
                    <span class="entry-count">+${e.p} порц.</span>`;
    els.todayList.appendChild(li);
  }
  els.todayEmpty.classList.toggle("hidden", list.length > 0);

  updateTimer();
}

// ---------- Таймер с последней порции ----------
function updateTimer() {
  const last = getLastUseTimeToday();
  els.lastUseTimer.textContent = last ? fmtDuration(Date.now() - last) : "—";
}

// ---------- История ----------
function renderHistory() {
  const daily = getDailyTotals();
  const total = state.entries.reduce((s, e) => s + e.p, 0);

  els.statTotal.textContent = total;
  els.statAvg.textContent = getAverageDailyTotal().toFixed(1).replace(/\.0$/, "");
  els.statMax.textContent = getMaxDailyTotal();

  // График последних 14 дней (включая пустые дни между первой и последней записью)
  els.chart.innerHTML = "";
  if (daily.length) {
    const days = [];
    let cur = daily[0].ts;
    const end = dayStartMillis(Date.now());
    while (cur <= end && days.length < 30) {
      days.push(cur);
      cur += 86400000;
    }
    const shown = days.slice(-14);
    const byTs = new Map(daily.map((d) => [d.ts, d.total]));
    const max = Math.max(state.dailyLimit, ...shown.map((ts) => byTs.get(ts) || 0), 1);
    for (const ts of shown) {
      const v = byTs.get(ts) || 0;
      const col = document.createElement("div");
      col.className = "chart-col";
      const bar = document.createElement("div");
      bar.className = "chart-bar" + (v > state.dailyLimit ? " over" : "");
      bar.style.height = Math.max(2, (v / max) * 70) + "px";
      bar.title = `${fmtDate(dayKey(ts))}: ${v} порц.`;
      const label = document.createElement("div");
      label.className = "chart-label";
      label.textContent = new Date(ts).getDate();
      col.append(bar, label);
      els.chart.appendChild(col);
    }
  }

  // Список по дням (новые сверху)
  els.historyList.innerHTML = "";
  const rev = daily.slice().reverse();
  for (const d of rev) {
    const li = document.createElement("li");
    const pouches = (d.total / state.portionsPerPouch).toFixed(2).replace(/\.?0+$/, "");
    li.innerHTML = `<span class="hist-date">${fmtDate(d.key)}</span>
                    <span><span class="hist-total">${d.total} порц.</span>
                    <span class="hist-pouches">≈ ${pouches} бан.</span></span>`;
    els.historyList.appendChild(li);
  }
  els.historyEmpty.classList.toggle("hidden", rev.length > 0);
}

// ---------- Настройки ----------
function fillSettings() {
  $("setLimit").value = state.dailyLimit;
  $("setPouch").value = state.portionsPerPouch;
  $("setNic").value = state.nicotineMgPerPortion;
}

function renderAll() {
  renderToday();
  renderHistory();
}

// ================= Обработчики =================

$("btnPlus").addEventListener("click", () => {
  addEntry(1);
  afterAdd();
});

$("btnMinus").addEventListener("click", () => {
  if (removeLastEntryToday()) renderAll();
});

$("btnCustom").addEventListener("click", () => {
  $("customAmount").value = "1";
  $("dlgCustom").showModal();
});

$("dlgCustom").addEventListener("close", () => {
  if ($("dlgCustom").returnValue === "ok") {
    const n = parseInt($("customAmount").value, 10);
    if (n > 0) {
      addEntry(n);
      afterAdd();
    }
  }
});

function afterAdd() {
  renderAll();
  const over = getTodayCount() > state.dailyLimit;
  if (over) {
    const card = document.querySelector(".counter-card");
    card.classList.remove("shake");
    void card.offsetWidth; // перезапуск анимации
    card.classList.add("shake");
    if (navigator.vibrate) navigator.vibrate(120);
  } else if (navigator.vibrate) {
    navigator.vibrate(20);
  }
}

// Вкладки
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "settings") fillSettings();
    renderAll();
  });
});

// Сохранение настроек
$("btnSaveSettings").addEventListener("click", () => {
  state.dailyLimit = Math.max(1, parseInt($("setLimit").value, 10) || 10);
  state.portionsPerPouch = Math.max(1, parseInt($("setPouch").value, 10) || 20);
  state.nicotineMgPerPortion = Math.max(0, parseFloat($("setNic").value) || 0);
  save();
  renderAll();
  const note = $("settingsSaved");
  note.classList.remove("hidden");
  setTimeout(() => note.classList.add("hidden"), 1500);
});

$("btnClearToday").addEventListener("click", () => {
  if (confirm("Обнулить счётчик за сегодня?")) {
    clearToday();
    renderAll();
  }
});

$("btnClearAll").addEventListener("click", () => {
  if (confirm("Удалить ВСЮ историю безвозвратно?")) {
    clearAll();
    renderAll();
  }
});

$("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `snus-counter-${dayKey(Date.now())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// Автосброс при смене дня (пользователь держит вкладку открытой через полночь)
let lastDay = dayKey(Date.now());
setInterval(() => {
  updateTimer();
  const nowDay = dayKey(Date.now());
  if (nowDay !== lastDay) {
    lastDay = nowDay;
    renderAll();
  }
}, 1000);

// Синхронизация между вкладками браузера
window.addEventListener("storage", () => {
  state = load();
  renderAll();
});

// Старт
fillSettings();
renderAll();
