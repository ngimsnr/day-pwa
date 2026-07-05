'use strict';

/* データ層: localStorage への永続化・日次レコード生成・集計。UI には依存しない。 */
const Store = (() => {
  const KEY = 'day-app-state-v1';

  /* ---- トレーニングメニュー (週スケジュール)。メニュー変更はここを編集 ---- */
  function defaultSchedules() {
    const upper = () => [
      { id: 'pushup', name: 'プッシュアップ', sets: 3, detail: '15回' },
      { id: 'dbrow', name: 'ワンハンドダンベルロー', sets: 3, detail: '左右10回' },
      { id: 'sideraise', name: 'サイドレイズ', sets: 3, detail: '15回' },
    ];
    const lower = () => [
      { id: 'lunge', name: 'ダンベルバックランジ (5kg×2)', sets: 3, detail: '左右15回' },
      { id: 'calfraise', name: 'カーフレイズ', sets: 3, detail: '15回' },
      { id: 'plank', name: 'プランク', sets: 3, detail: '30秒' },
    ];
    // 土日: フットサルはどちらか1日、もう1日はウォーキング (anyOne = どれか1つ完了で達成)
    const weekend = () => [
      { id: 'futsal', name: 'フットサル', sets: 1, detail: '' },
      { id: 'walk', name: 'ウォーキング', sets: 1, detail: '20分' },
    ];
    return [
      { weekday: 1, label: 'Upper', anyOne: false, items: upper() },
      { weekday: 2, label: 'Lower', anyOne: false, items: lower() },
      { weekday: 3, label: null, anyOne: false, items: [{ id: 'walk', name: 'ウォーキング', sets: 1, detail: '20分' }] },
      { weekday: 4, label: 'Upper', anyOne: false, items: upper() },
      { weekday: 5, label: 'Lower', anyOne: false, items: lower() },
      { weekday: 6, label: null, anyOne: true, items: weekend() },
      { weekday: 7, label: null, anyOne: true, items: weekend() },
    ];
  }

  /* ---- 固定食材 (分量あたりの PFC)。値の変更はここを編集 ---- */
  const DEFAULT_FOODS = [
    // [名前, 分量, P, F, C]
    ['ヨーグルト', '100g', 3.6, 3.0, 4.9],
    ['キウイ', '1個', 0.9, 0.2, 11.5],
    ['ブルーベリー', '50g', 0.3, 0.1, 6.4],
    ['ベースブレッド', '1個', 13.5, 8.5, 32],
    ['十割そば', '1食', 7.5, 1.2, 43],
    ['鶏むね肉', '100g', 23, 2, 0],
    ['ゆで卵', '1個', 6.5, 5.2, 0.2],
    ['納豆', '40g', 6.6, 4.2, 5.8],
    ['キムチ', '50g', 1.6, 0.2, 2.7],
    ['豆腐', '150g', 7.2, 3.8, 6.6],
    ['もずく', '70g', 0.1, 0.1, 1.5],
    ['プロテイン', '1杯', 21.8, 1.8, 3.6],
  ];

  function defaultState() {
    return {
      version: 4,
      settings: { proteinTarget: 100, fatTarget: 60, carbTarget: 250 },
      templates: DEFAULT_FOODS.map(([name, unit, p, f, c], i) => ({
        id: 'd' + (i + 1), name, unit, p, f, c, isDefault: true, sortOrder: i, lastUsedAt: 0,
      })),
      schedules: defaultSchedules(),
      days: {},
    };
  }

  /* ---- 既存端末データの移行 (v1 → v2 → v3)。記録は保ったまま新形式へ ---- */
  function migrate(s) {
    if (!s) return s;
    if (s.version === 1) migrateV2(s);
    if (s.version === 2) migrateV3(s);
    if (s.version === 3) migrateV4(s);
    return s;
  }

  function migrateV2(s) {
    // 食材テンプレートに分量ラベルを追加
    s.templates.forEach((t) => { if (t.unit == null) t.unit = ''; });

    // 十割そば・鶏むね肉 を「ベースブレッド」(無ければ「パン」) の後ろに挿入
    const defaults = s.templates.filter((t) => t.isDefault).sort((a, b) => a.sortOrder - b.sortOrder);
    if (!defaults.some((t) => t.name === '十割そば')) {
      let anchor = defaults.findIndex((t) => t.name === 'ベースブレッド');
      if (anchor < 0) anchor = defaults.findIndex((t) => t.name === 'パン');
      const at = anchor >= 0 ? anchor + 1 : defaults.length;
      defaults.splice(at, 0,
        { id: 'm-soba', name: '十割そば', unit: '1食', p: 7.5, f: 1.2, c: 43, isDefault: true, lastUsedAt: 0 },
        { id: 'm-chicken', name: '鶏むね肉', unit: '100g', p: 23, f: 2, c: 0, isDefault: true, lastUsedAt: 0 });
      defaults.forEach((t, i) => { t.sortOrder = i; });
      s.templates = defaults.concat(s.templates.filter((t) => !t.isDefault));
    }

    // トレーニングは新メニューへ全面置き換え
    s.schedules = defaultSchedules();

    // 各日: 食事チェック true/false → 個数 (1/0)、トレーニング記録は新形式で作り直し
    for (const key of Object.keys(s.days)) {
      const day = s.days[key];
      const food = {};
      for (const [id, v] of Object.entries(day.food)) {
        food[id] = typeof v === 'number' ? v : (v ? 1 : 0);
      }
      day.food = food;
      day.training = { done: {} };
    }

    s.version = 2;
  }

  // 固定食材の分量と PFC を DEFAULT_FOODS の値に揃える (名前一致で更新)
  function applyDefaultFoods(s) {
    const byName = new Map(DEFAULT_FOODS.map(([name, unit, p, f, c]) => [name, { unit, p, f, c }]));
    s.templates.forEach((t) => {
      const v = t.isDefault && byName.get(t.name);
      if (v) { t.unit = v.unit; t.p = v.p; t.f = v.f; t.c = v.c; }
    });
  }

  function migrateV3(s) {
    applyDefaultFoods(s);
    s.version = 3;
  }

  // v4: 実測 PFC への更新 (2026-07-06)
  function migrateV4(s) {
    applyDefaultFoods(s);
    s.version = 4;
  }

  let state;
  try {
    state = migrate(JSON.parse(localStorage.getItem(KEY))) || defaultState();
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
    return {
      start: new Date(now.getFullYear(), now.getMonth() + offset, 1),
      end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 1),
    };
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

  // その日のレコードを保証する (固定食材は ×1 チェック ON で生成)。冪等。
  // 今日については、後から追加された固定食材を未チェックで補充する。
  function ensureDay(key) {
    let day = state.days[key];
    if (!day) {
      const food = {};
      state.templates.filter((t) => t.isDefault).forEach((t) => { food[t.id] = 1; });
      day = state.days[key] = {
        trade: { stock: 0, future: 0 },
        food,
        training: { done: {} },
      };
      save();
    } else if (key === todayKey()) {
      let changed = false;
      state.templates.filter((t) => t.isDefault).forEach((t) => {
        if (!(t.id in day.food)) { day.food[t.id] = 0; changed = true; }
      });
      if (!day.training || !day.training.done) { day.training = { done: {} }; changed = true; }
      if (changed) save();
    }
    return day;
  }

  function scheduleFor(key) {
    const wd = mondayWeekday(parseKey(key));
    return state.schedules.find((s) => s.weekday === wd) || null;
  }

  function template(id) {
    return state.templates.find((t) => t.id === id) || null;
  }

  function addTemplate(name, unit, p, f, c) {
    const t = {
      id: 'x' + Date.now(), name, unit, p, f, c,
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

  /* ---- 集計 ---- */

  // チェックした食材の PFC 合計 (個数を掛ける)
  function pfcTotals(day) {
    const acc = { p: 0, f: 0, c: 0 };
    if (!day) return acc;
    for (const [id, qty] of Object.entries(day.food)) {
      if (!qty) continue;
      const t = template(id);
      if (t) { acc.p += t.p * qty; acc.f += t.f * qty; acc.c += t.c * qty; }
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
      if (!day || !Object.values(day.food).some((q) => q > 0)) continue;
      const t = pfcTotals(day);
      p += t.p / Math.max(s.proteinTarget, 1);
      f += t.f / Math.max(s.fatTarget, 1);
      c += t.c / Math.max(s.carbTarget, 1);
      n += 1;
    }
    return n === 0 ? null : { p: p / n, f: f / n, c: c / n };
  }

  // その日のトレーニングが完了しているか。
  // 通常日 = 全種目のセット完了、anyOne の日 (土日) = どれか1種目の完了で達成。
  function isDayTrainingComplete(day, schedule) {
    if (!schedule || !schedule.items.length) return false;
    const done = (day && day.training && day.training.done) || {};
    const ok = (item) => (done[item.id] || 0) >= item.sets;
    return schedule.anyOne ? schedule.items.some(ok) : schedule.items.every(ok);
  }

  // 達成日数 / 予定日数。未来日は分母に入れない。
  function trainingSummary(keys) {
    const today = todayKey();
    let completed = 0, scheduled = 0;
    for (const key of keys) {
      if (key > today) continue;
      const schedule = scheduleFor(key);
      if (!schedule || !schedule.items.length) continue;
      scheduled += 1;
      if (isDayTrainingComplete(state.days[key], schedule)) completed += 1;
    }
    return { completed, scheduled };
  }

  /* ---- バックアップ ---- */

  function exportJSON() {
    return JSON.stringify(state, null, 1);
  }

  function importJSON(text) {
    const parsed = migrate(JSON.parse(text));
    if (!parsed || parsed.version !== 4 || !parsed.days || !parsed.templates) {
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
    save,
    dateKey, parseKey, todayKey, mondayWeekday, addDays, keysIn,
    weekInterval, monthInterval, yearInterval, isoWeek,
    ensureDay, scheduleFor, template, addTemplate, recentTemplates,
    pfcTotals, tradeSummary, foodRates, trainingSummary, isDayTrainingComplete,
    exportJSON, importJSON, exportCSV,
  };
})();
