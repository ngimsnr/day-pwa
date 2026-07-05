'use strict';

/* データ層: localStorage への永続化・日次レコード生成・集計。UI には依存しない。 */
const Store = (() => {
  const KEY = 'day-app-state-v1';

  const EXERCISES = {
    pushup: { name: '腕立て', timed: false },
    squat:  { name: 'スクワット', timed: false },
    plank:  { name: 'プランク', timed: true },
  };

  function defaultState() {
    // 初期値は汎用的なサンプル。実際の食材・目標値は各自の端末内で育つ
    const foods = [
      ['ごはん', 4, 0.5, 55], ['パン', 9, 4, 45], ['卵', 6.5, 5.5, 0.5],
      ['鶏むね肉', 22, 2, 0], ['魚', 20, 5, 0], ['野菜', 2, 0, 5],
      ['果物', 1, 0, 15], ['乳製品', 7, 8, 10], ['大豆製品', 8, 5, 4], ['プロテイン', 20, 2, 3],
    ];
    return {
      version: 1,
      settings: { proteinTarget: 100, fatTarget: 60, carbTarget: 250 },
      templates: foods.map(([name, p, f, c], i) => ({
        id: 'd' + (i + 1), name, p, f, c, isDefault: true, sortOrder: i, lastUsedAt: 0,
      })),
      schedules: [
        { weekday: 1, exercise: 'pushup', targetReps: 20, targetSets: 3, targetSeconds: null },
        { weekday: 2, exercise: 'squat',  targetReps: 20, targetSets: 3, targetSeconds: null },
        { weekday: 3, exercise: 'plank',  targetReps: null, targetSets: 3, targetSeconds: 60 },
        { weekday: 4, exercise: 'pushup', targetReps: 20, targetSets: 3, targetSeconds: null },
        { weekday: 5, exercise: 'squat',  targetReps: 20, targetSets: 3, targetSeconds: null },
        { weekday: 6, exercise: 'plank',  targetReps: null, targetSets: 3, targetSeconds: 60 },
        { weekday: 7, exercise: null, targetReps: null, targetSets: 0, targetSeconds: null },
      ],
      days: {},
    };
  }

  let state;
  try {
    state = JSON.parse(localStorage.getItem(KEY)) || defaultState();
  } catch (e) {
    state = defaultState();
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /* ---- 日付ヘルパー (すべて端末ローカル時刻・月曜始まり) ---- */

  function dateKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function todayKey() { return dateKey(new Date()); }
  function mondayWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); } // 1=月〜7=日
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

  // [start, end) の日付キー列
  function keysIn(start, end) {
    const keys = [];
    for (let d = new Date(start); d < end; d = addDays(d, 1)) keys.push(dateKey(d));
    return keys;
  }

  function weekInterval(offset) {
    const now = new Date();
    const start = addDays(now, -(mondayWeekday(now) - 1) + offset * 7);
    start.setHours(0, 0, 0, 0);
    return { start, end: addDays(start, 7) };
  }
  function monthInterval(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { start, end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 1) };
  }
  function yearInterval(offset) {
    const y = new Date().getFullYear() + offset;
    return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }
  // ISO 週番号
  function isoWeek(d) {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + 4 - mondayWeekday(t));
    const jan1 = new Date(t.getFullYear(), 0, 1);
    return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  }

  /* ---- 日次レコード ---- */

  // その日のレコードを保証する (固定食材はチェック ON で生成)。冪等。
  function ensureDay(key) {
    if (!state.days[key]) {
      const food = {};
      state.templates.filter((t) => t.isDefault).forEach((t) => { food[t.id] = true; });
      const schedule = scheduleFor(key);
      state.days[key] = {
        trade: { stock: 0, future: 0 },
        food,
        training: schedule && schedule.exercise
          ? { exercise: schedule.exercise, completedSets: 0 }
          : null,
      };
      save();
    }
    return state.days[key];
  }

  function scheduleFor(key) {
    const wd = mondayWeekday(parseKey(key));
    return state.schedules.find((s) => s.weekday === wd) || null;
  }

  function template(id) {
    return state.templates.find((t) => t.id === id) || null;
  }

  function addTemplate(name, p, f, c) {
    const t = {
      id: 'x' + Date.now(), name, p, f, c,
      isDefault: false, sortOrder: Date.now(), lastUsedAt: Date.now(),
    };
    state.templates.push(t);
    save();
    return t;
  }

  function recentTemplates(limit) {
    return state.templates
      .filter((t) => !t.isDefault)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit);
  }

  /* ---- 集計 (Swift 版 Aggregator と同じ規則) ---- */

  // チェック ON の食材の PFC 合計
  function pfcTotals(day) {
    const acc = { p: 0, f: 0, c: 0 };
    if (!day) return acc;
    for (const [id, on] of Object.entries(day.food)) {
      if (!on) continue;
      const t = template(id);
      if (t) { acc.p += t.p; acc.f += t.f; acc.c += t.c; }
    }
    return acc;
  }

  function tradeSummary(keys) {
    const acc = { stock: 0, future: 0 };
    for (const key of keys) {
      const day = state.days[key];
      if (day) { acc.stock += day.trade.stock; acc.future += day.trade.future; }
    }
    acc.total = acc.stock + acc.future;
    return acc;
  }

  // 記録がある日の日次達成率の平均。1日もなければ null。
  function foodRates(keys) {
    const s = state.settings;
    let p = 0, f = 0, c = 0, n = 0;
    for (const key of keys) {
      const day = state.days[key];
      if (!day || !Object.values(day.food).some(Boolean)) continue;
      const t = pfcTotals(day);
      p += t.p / Math.max(s.proteinTarget, 1);
      f += t.f / Math.max(s.fatTarget, 1);
      c += t.c / Math.max(s.carbTarget, 1);
      n += 1;
    }
    return n === 0 ? null : { p: p / n, f: f / n, c: c / n };
  }

  // 達成日数 / 予定日数。休みの日と未来日は分母に入れない。
  function trainingSummary(keys) {
    const today = todayKey();
    let completed = 0, scheduled = 0;
    for (const key of keys) {
      if (key > today) continue;
      const schedule = scheduleFor(key);
      if (!schedule || !schedule.exercise) continue;
      scheduled += 1;
      const day = state.days[key];
      if (day && day.training && day.training.completedSets >= schedule.targetSets) completed += 1;
    }
    return { completed, scheduled };
  }

  /* ---- バックアップ ---- */

  function exportJSON() {
    return JSON.stringify(state, null, 1);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.version !== 1 || !parsed.days || !parsed.templates) {
      throw new Error('形式が違います');
    }
    state = parsed;
    save();
  }

  function exportCSV() {
    const rows = [['date', 'stock', 'future', 'total']];
    for (const key of Object.keys(state.days).sort()) {
      const t = state.days[key].trade;
      rows.push([key, t.stock, t.future, t.stock + t.future]);
    }
    return rows.map((r) => r.join(',')).join('\n');
  }

  return {
    get state() { return state; },
    save, EXERCISES,
    dateKey, parseKey, todayKey, mondayWeekday, addDays, keysIn,
    weekInterval, monthInterval, yearInterval, isoWeek,
    ensureDay, scheduleFor, template, addTemplate, recentTemplates,
    pfcTotals, tradeSummary, foodRates, trainingSummary,
    exportJSON, importJSON, exportCSV,
  };
})();
