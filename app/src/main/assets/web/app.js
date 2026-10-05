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
    return { ...structuredClone(defaults), ...parsed, entries: repairEntries(parsed.entries) };
  } catch {
    return structuredClone(defaults);
  }
}

/**
 * Починка повреждённых записей при загрузке:
 *  - метка в будущем (сбитые часы устройства) -> переносим на «сейчас»,
 *    иначе таймер «с последней порции» показывает мусор;
 *  - отрицательные/NaN/некорректные значения -> удаляем.
 */
function repairEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const maxTs = now + 60000;
  const out = [];
  for (const e of raw) {
    if (!e || !Number.isFinite(e.p) || e.p <= 0) continue;
    if (!Number.isFinite(e.t) || e.t < 0) continue;
    if (e.t > maxTs) { e.t = now; } // «будущая» метка -> текущая
    out.push(e);
  }
  return out;
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
  const now = Date.now();
  // Защита от «будущих» меток времени (сбитые часы устройства): не даём
  // таймеру «с последней порции» уйти в отрицательную зону.
  if (!isFinite(now) || now < 0) return;
  state.entries.push({ t: now, p: Math.max(1, Math.round(portions)) });
  save();
}

/** Игнорируем записи с невозможными метками (отрицательные / из будущего). */
function isValidTs(ts) {
  return Number.isFinite(ts) && ts >= 0 && ts <= Date.now() + 60000;
}

/**
 * Авто-починка «будущих» меток: если часы устройства были сбиты вперёд
 * (или трюк с offline-first), запись оказывается в будущем и ломает
 * таймер «с последней порции». Молча переносим такие метки на текущее
 * время — данные сохраняются, аномалия исчезает.
 */
function fixFutureTimestamps() {
  const maxTs = Date.now() + 60000;
  let changed = false;
  for (const e of state.entries) {
    if (Number.isFinite(e.t) && e.t > maxTs) {
      e.t = Date.now();
      changed = true;
    }
  }
  if (changed) save();
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
/** Максимально реалистичная длительность: ~3 года в миллисекундах.
 *  Всё, что больше — почти наверняка битые данные (сбитые часы,
 *  импорт, баги меток времени), показываем «—». */
const MAX_PLAUSIBLE_MS = 3 * 365 * 86400000;

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_PLAUSIBLE_MS) return "—";
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
  // На всякий случай чиним «будущие» метки (например, часы устройства
  // сбились вперёд во время работы вкладки) — иначе diff уйдёт в минус.
  fixFutureTimestamps();
  const last = getLastUseTimeToday();
  if (!last || !isValidTs(last)) {
    els.lastUseTimer.textContent = "—";
    return;
  }
  // Отрицательная разница невозможна, но на всякий случай зажимаем в ноль.
  const diff = Math.max(0, Date.now() - last);
  els.lastUseTimer.textContent = diff < 1000 ? "только что" : fmtDuration(diff);
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

/* ============================================================
   ПЛЕЕР — коллекция MC Крапива
   Треки хранятся как ссылки на легальные источники (localStorage).
   Аудиофайлы в репозиторий не добавляем (авторские права).
   ============================================================ */

const AUDIO_RE = /\.(mp3|ogg|oga|m4a|aac|wav|weba|webm|flac)(\?|#|$)/i;

// Стартовая коллекция по умолчанию — 3 трека MC Крапива (ссылки на lightaudio.ru).
// Ссылки могут быть временными; пользователь всегда может заменить/добавить свои
// через карточку «Добавить песню». SEED_VERSION — версия сида для авто-миграции.
const SEED_VERSION = 2;
const KRAPIVA_SEED = [
  {
    title: "MC Крапива — Крутые пацаны живут с мамой",
    url: "https://storage9.lightaudio.ru/dm/39a09105/3bb509b2/%D0%BC%D1%86%20%D0%BA%D1%80%D0%B0%D0%BF%D0%B8%D0%B2%D0%B0%20%E2%80%94%20%D0%9A%D1%80%D1%83%D1%82%D1%8B%D0%B5%20%D0%BF%D0%B0%D1%86%D0%B0%D0%BD%D1%8B%20%D0%B6%D0%B8%D0%B2%D1%83%D1%82%20%D1%81%20%D0%BC%D0%B0%D0%BC%D0%BE%D0%B9.mp3?d=138&v=dcb772be6f",
  },
  {
    title: "MC Крапива — Люблю Пиво",
    url: "https://storage9.lightaudio.ru/dm/39a08dfd/3bb50938/%D0%BC%D1%86%20%D0%BA%D1%80%D0%B0%D0%BF%D0%B8%D0%B2%D0%B0%20%E2%80%94%20%D0%9B%D1%8E%D0%B1%D0%BB%D1%8E%20%D0%BF%D0%B8%D0%B2%D0%BE.mp3?d=162&v=cb7073d467",
  },
  {
    title: "MC Крапива — Виноградный день",
    url: "https://storage4.lightaudio.ru/dm/39a09a92/3bb5093f/%D0%BC%D1%86%20%D0%BA%D1%80%D0%B0%D0%BF%D0%B8%D0%B2%D0%B0%20%E2%80%94%20%D0%92%D0%B8%D0%BD%D0%BE%D0%B3%D1%80%D0%B0%D0%B4%D0%BD%D1%8B%D0%B9%20%D0%B4%D0%B5%D0%BD%D1%8C.mp3?d=144&v=1eff9dda0c",
  },
];

const pel = (id) => document.getElementById(id);
const audioEl = pel("audioEl");
const player = {
  tracks: [],        // [{title, url}]
  current: -1,       // индекс играющего трека
  playing: false,
  shuffle: false,
};

function loadTracks() {
  let raw = null;
  try { raw = localStorage.getItem("snus.tracks"); } catch (e) {}
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // Миграция: если пользователь ничего не менял (сид v1 без URL или старый
        // номер версии) — подменяем коллекцию новым сидом по умолчанию.
        let ver = null;
        try { ver = localStorage.getItem("snus.seedVer"); } catch (e) {}
        const untouchedV1 = arr.length > 0 && arr.every((t) => t && t.title && !t.url);
        if (ver !== String(SEED_VERSION) && (untouchedV1 || arr.length === 0)) {
          return seedTracks();
        }
        return arr.filter((t) => t && t.title);
      }
    } catch (e) {}
  }
  // Первый запуск: сид-коллекция по умолчанию
  return seedTracks();
}

function seedTracks() {
  try { localStorage.setItem("snus.seedVer", String(SEED_VERSION)); } catch (e) {}
  return KRAPIVA_SEED.map((t) => ({ title: t.title, url: t.url || "" }));
}

function saveTracks() {
  try { localStorage.setItem("snus.tracks", JSON.stringify(player.tracks)); } catch (e) {}
}

player.tracks = loadTracks();
try { player.shuffle = localStorage.getItem("snus.shuffle") === "1"; } catch (e) {}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m + ":" + String(r).padStart(2, "0");
}

function renderTrackList() {
  const ul = pel("trackList");
  ul.innerHTML = "";
  pel("trackCount").textContent = "(" + player.tracks.length + ")";
  pel("tracksEmpty").classList.toggle("hidden", player.tracks.length > 0);

  player.tracks.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = "track-item" + (i === player.current ? " current" : "");

    const num = document.createElement("span");
    num.className = "t-num";
    num.textContent = i === player.current && player.playing ? "♫" : String(i + 1);

    const name = document.createElement("span");
    name.className = "t-name";
    name.textContent = t.title;
    if (!t.url) name.style.opacity = ".55";

    li.appendChild(num);
    li.appendChild(name);

    if (!t.url) {
      const tag = document.createElement("span");
      tag.className = "t-playing";
      tag.style.color = "#8b949e";
      tag.textContent = "нет URL";
      li.appendChild(tag);
    }

    const del = document.createElement("button");
    del.className = "t-del";
    del.title = "Удалить из коллекции";
    del.textContent = "✕";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!confirm(`Удалить «${t.title}» из коллекции?`)) return;
      const wasCurrent = i === player.current;
      player.tracks.splice(i, 1);
      if (wasCurrent) stopPlayback();
      else if (player.current > i) player.current--;
      saveTracks();
      renderTrackList();
    });
    li.appendChild(del);

    li.addEventListener("click", () => playTrack(i));
    ul.appendChild(li);
  });
}

function playFailHelp(i) {
  // Прямое воспроизведение не удалось (403 hotlink / нет CORS / ссылка протухла).
  // Публичные CORS-прокси сырой аудио-стрим не тянут, поэтому остаётся
  // подсказать пользователю, как получить рабочую ссылку.
  const t = player.tracks[i];
  showAddNote("«" + (t ? t.title : "") + "» не играет: хост блокирует прямые запросы или ссылка устарела. Откройте страницу трека на источнике, нажмите «Слушать» и скопируйте актуальную ссылку из плеера — она живёт несколько часов.", true);
  stopPlayback();
}

function playTrack(i) {
  const t = player.tracks[i];
  if (!t) return;
  if (!t.url) {
    showAddNote("У трека «" + t.title + "» нет ссылки на аудио. Добавьте URL ниже.", true);
    return;
  }
  player.current = i;
  audioEl.src = t.url;
  audioEl.play().catch(() => {
    showAddNote("Запуск отменён: проверьте ссылку (хост может требовать свежую прямую ссылку).", true);
  });
  pel("playerName").textContent = t.title;
  updateNowPlayingMeta(t.title);
  renderTrackList();
}

function stopPlayback() {
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  player.current = -1;
  player.playing = false;
  pel("btnPlay").textContent = "▶";
  pel("playerCover").classList.remove("playing");
  pel("playerName").textContent = "— выберите трек —";
  pel("seekBar").value = 0;
  pel("timeNow").textContent = "0:00";
  pel("timeDur").textContent = "0:00";
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

function nextTrack(auto) {
  if (!player.tracks.length) return;
  const playable = player.tracks.map((t, i) => (t.url ? i : -1)).filter((i) => i >= 0);
  if (!playable.length) return;
  let idx;
  if (player.shuffle && playable.length > 1) {
    do { idx = playable[Math.floor(Math.random() * playable.length)]; }
    while (idx === player.current);
  } else {
    const pos = playable.indexOf(player.current);
    idx = playable[(pos + 1) % playable.length];
  }
  playTrack(idx);
  if (!auto && !player.playing) togglePlay();
}

function prevTrack() {
  if (!player.tracks.length) return;
  if (audioEl.currentTime > 3) { audioEl.currentTime = 0; return; }
  const playable = player.tracks.map((t, i) => (t.url ? i : -1)).filter((i) => i >= 0);
  if (!playable.length) return;
  const pos = playable.indexOf(player.current);
  const idx = playable[(pos - 1 + playable.length) % playable.length];
  playTrack(idx);
}

function togglePlay() {
  if (player.current < 0) {
    const firstPlayable = player.tracks.findIndex((t) => t.url);
    if (firstPlayable >= 0) playTrack(firstPlayable);
    return;
  }
  if (audioEl.paused) audioEl.play().catch(() => {});
  else audioEl.pause();
}

function updateNowPlayingMeta(title) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: "MC Крапива", album: "Снюс-счётчик FM",
    });
    navigator.mediaSession.setActionHandler("play", () => audioEl.play());
    navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(false));
  } catch (e) {}
}

// События аудио
audioEl.addEventListener("play", () => {
  player.playing = true;
  pel("btnPlay").textContent = "⏸";
  pel("playerCover").classList.add("playing");
});
audioEl.addEventListener("pause", () => {
  player.playing = false;
  pel("btnPlay").textContent = "▶";
  pel("playerCover").classList.remove("playing");
  renderTrackList();
});
audioEl.addEventListener("ended", () => nextTrack(true));
audioEl.addEventListener("error", () => {
  if (player.current >= 0) {
    const t = player.tracks[player.current];
    // Упал прямой источник (403/hotlink/CORS) — пробуем прокси, если он ещё не сохранён как рабочий
    if (t && t.origUrl && t.url === t.origUrl) { playFailHelp(player.current); return; }
    showAddNote("Ошибка загрузки: " + (t ? t.title : ""), true);
  }
  pel("btnPlay").textContent = "▶";
  pel("playerCover").classList.remove("playing");
  player.playing = false;
});
audioEl.addEventListener("loadedmetadata", () => {
  pel("timeDur").textContent = fmtTime(audioEl.duration);
});
audioEl.addEventListener("timeupdate", () => {
  if (pel("seekBar").dataset.dragging === "1") return;
  pel("timeNow").textContent = fmtTime(audioEl.currentTime);
  if (isFinite(audioEl.duration) && audioEl.duration > 0) {
    pel("seekBar").value = (audioEl.currentTime / audioEl.duration) * 100;
  }
});

// Контролы
pel("btnPlay").addEventListener("click", togglePlay);
pel("btnNext").addEventListener("click", () => nextTrack(false));
pel("btnPrev").addEventListener("click", prevTrack);

pel("volBar").addEventListener("input", () => {
  audioEl.volume = parseFloat(pel("volBar").value);
  try { localStorage.setItem("snus.vol", pel("volBar").value); } catch (e) {}
});
audioEl.volume = parseFloat(localStorage.getItem("snus.vol") || "0.8");

const seek = pel("seekBar");
seek.addEventListener("pointerdown", () => (seek.dataset.dragging = "1"));
seek.addEventListener("pointerup", () => (seek.dataset.dragging = "0"));
seek.addEventListener("input", () => {
  if (isFinite(audioEl.duration)) {
    pel("timeNow").textContent = fmtTime((seek.value / 100) * audioEl.duration);
  }
});
seek.addEventListener("change", () => {
  if (isFinite(audioEl.duration) && audioEl.duration > 0) {
    audioEl.currentTime = (seek.value / 100) * audioEl.duration;
  }
});

pel("chkShuffle").checked = player.shuffle;
pel("chkShuffle").addEventListener("change", () => {
  player.shuffle = pel("chkShuffle").checked;
  try { localStorage.setItem("snus.shuffle", player.shuffle ? "1" : "0"); } catch (e) {}
});

// Добавление трека
function showAddNote(msg, isError) {
  const note = pel("addNote");
  note.textContent = msg;
  note.style.color = isError ? "#f85149" : "#2ea043";
  note.classList.remove("hidden");
  setTimeout(() => note.classList.add("hidden"), 2500);
}

// Проверка доступности ссылки из браузера. no-cors HEAD даёт opaque-ответ даже
// при HTTP 403, поэтому дополнительно делаем cors-запрос: на хостах без CORS-
// заголовков он упадёт с TypeError — это не значит, что ссылка битая.
async function isPlayable(url) {
  try {
    const r = await fetch(url, { method: "HEAD", mode: "no-cors" });
    if (r.type !== "opaque") return r.ok;           // CORS разрешён — статус честный
  } catch (e) { /* сеть/CORS — пробуем следующий способ */ }
  try {
    const r = await fetch(url, { method: "GET", mode: "cors", signal: AbortSignal.timeout(6000) });
    return r.ok;                                    // удалось прочитать — файл живой
  } catch (e) {
    return true;   // скорее всего нет CORS-заголовков, а не 404/403
  }
}

async function addTrack() {
  const btn = pel("btnAddTrack");
  const title = pel("addTitle").value.trim();
  const url = pel("addUrl").value.trim();
  if (!title) return showAddNote("Введите название.", true);
  if (!url) return showAddNote("Введите ссылку на аудио.", true);
  if (!/^https?:\/\//i.test(url)) return showAddNote("Ссылка должна начинаться с http(s)://", true);
  if (!AUDIO_RE.test(url)) {
    if (!confirm("Ссылка не похожа на прямой аудиофайл (mp3/ogg/m4a/wav). Всё равно добавить?")) return;
  }
  if (player.tracks.some((t) => t.url === url || t.origUrl === url)) {
    return showAddNote("Такой трек уже в коллекции.", true);
  }

  btn.disabled = true;
  showAddNote("Проверяю ссылку…", false);
  const ok = await isPlayable(url);
  btn.disabled = false;
  if (!ok) {
    showAddNote("Ссылка не отвечает (битая или уже устарела). Скопируйте актуальную ссылку из плеера источника — такие временные ссылки обычно живут несколько часов.", true);
    return;
  }

  player.tracks.push({ title, url, origUrl: url });
  saveTracks();
  renderTrackList();
  pel("addTitle").value = "";
  pel("addUrl").value = "";
  showAddNote("Добавлено ✓", false);
}

pel("btnAddTrack").addEventListener("click", addTrack);

renderTrackList();
