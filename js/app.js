'use strict';

/* UI 層: 描画とイベント。データの規則は Store に任せる。 */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const WEEKDAY_JA = ['月', '火', '水', '木', '金', '土', '日'];

  let currentTab = 'today';
  let currentDayKey = Store.todayKey();
  let historyScope = 'weekly'; // 週が最重要画面
  const offsets = { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
  let selectedCalKey = null;

  /* ---- 書式 ---- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => Math.abs(n).toLocaleString('ja-JP');
  const yen = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(n) + '円';
  const compact = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(n);
  const pct = (x) => Math.round(x * 100) + '%';
  const titleFor = (key) => {
    const d = Store.parseKey(key);
    return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_JA[Store.mondayWeekday(d) - 1]})`;
  };
  // 「3セット × 15回」/ 1セット物は「20分」だけ
  const targetText = (item) => item.sets > 1
    ? `${item.sets}セット × ${item.detail}`
    : item.detail;

  /* ================= Today ================= */

  function renderToday() {
    const day = Store.ensureDay(currentDayKey);
    updateTopbar();
    renderTradeInputs(day);
    renderPFC(day);
    renderFoodLists(day);
    renderTraining(day);
  }

  /* ---- 日付ナビゲーション (過去日の入力) ---- */
  function updateTopbar() {
    const onToday = currentTab === 'today';
    $('#day-prev').hidden = !onToday;
    $('#day-next').hidden = !onToday;
    $('#day-next').disabled = currentDayKey >= Store.todayKey();
    $('#btn-today-back').hidden = !onToday || currentDayKey === Store.todayKey();
    $('#topbar-title').textContent = onToday ? titleFor(currentDayKey) : 'History';
  }
  function goToDay(key) {
    currentDayKey = key;
    renderToday();
  }
  $('#day-prev').addEventListener('click', () =>
    goToDay(Store.dateKey(Store.addDays(Store.parseKey(currentDayKey), -1))));
  $('#day-next').addEventListener('click', () => {
    const next = Store.dateKey(Store.addDays(Store.parseKey(currentDayKey), 1));
    if (next <= Store.todayKey()) goToDay(next);
  });
  $('#btn-today-back').addEventListener('click', () => goToDay(Store.todayKey()));

  /* ---- Trade ---- */
  function renderTradeInputs(day) {
    for (const field of ['stock', 'future']) {
      const value = day.trade[field];
      const input = $('#in-' + field);
      input.value = value === 0 ? '' : fmtNum(value);
      setSign($('#sign-' + field), value < 0);
    }
  }
  function setSign(btn, minus) {
    btn.textContent = minus ? '−' : '+';
    btn.classList.toggle('minus', minus);
  }
  function bindTrade(field) {
    const input = $('#in-' + field);
    const signBtn = $('#sign-' + field);
    const apply = () => {
      const digits = input.value.replace(/[^0-9]/g, '');
      const magnitude = digits ? parseInt(digits, 10) : 0;
      const minus = signBtn.classList.contains('minus');
      const day = Store.ensureDay(currentDayKey);
      day.trade[field] = minus ? -magnitude : magnitude;
      Store.save();
      input.value = digits ? fmtNum(magnitude) : '';
    };
    input.addEventListener('input', apply);
    signBtn.addEventListener('click', () => {
      setSign(signBtn, !signBtn.classList.contains('minus'));
      apply();
    });
  }
  bindTrade('stock');
  bindTrade('future');

  /* ---- Food ---- */
  function renderPFC(day) {
    const t = Store.pfcTotals(day);
    const s = Store.state.settings;
    const bar = (label, cur, target) => {
      const w = Math.min(cur / Math.max(target, 1), 1) * 100;
      return `<div class="pfc"><div class="pfc-head"><b>${label}</b><span>${Math.round(cur)} / ${target}</span></div><div class="pfc-track"><div class="pfc-fill" style="width:${w}%"></div></div></div>`;
    };
    $('#pfc-bars').innerHTML =
      bar('P', t.p, s.proteinTarget) + bar('F', t.f, s.fatTarget) + bar('C', t.c, s.carbTarget);
  }

  function renderFoodLists(day) {
    const entries = Object.entries(day.food)
      .map(([id, qty]) => ({ template: Store.template(id), qty, id }))
      .filter((e) => e.template)
      .sort((a, b) => a.template.sortOrder - b.template.sortOrder);

    const row = (e) => {
      const unit = e.template.unit
        ? `<span class="food-unit">${e.template.unit}</span>` : '';
      const stepper = e.qty > 0
        ? `<span class="qty-ctl">` +
          `<button class="qty-btn" data-id="${e.id}" data-q="-1" aria-label="${e.template.name}を減らす">−</button>` +
          `<span class="qty-val">×${e.qty}</span>` +
          `<button class="qty-btn" data-id="${e.id}" data-q="1" aria-label="${e.template.name}を増やす">＋</button>` +
          `</span>`
        : '';
      return `<li data-id="${e.id}" class="${e.qty > 0 ? '' : 'off'}" role="checkbox" aria-checked="${e.qty > 0}" aria-label="${e.template.name}">` +
        `<span class="checkmark"></span><span class="food-name">${e.template.name}${unit}</span>${stepper}</li>`;
    };

    const defaults = entries.filter((e) => e.template.isDefault);
    const extras = entries.filter((e) => !e.template.isDefault);
    $('#food-list-default').innerHTML = defaults.map(row).join('');
    $('#food-list-extra').innerHTML = extras.map(row).join('');
    $('#food-extra-wrap').hidden = extras.length === 0;
  }

  function bindFoodList(sel) {
    $(sel).addEventListener('click', (ev) => {
      const day = Store.ensureDay(currentDayKey);
      const qbtn = ev.target.closest('.qty-btn');
      if (qbtn) {
        // 個数の増減 (×1〜×9)。×1 で − を押したらチェック解除
        const id = qbtn.dataset.id;
        const next = (day.food[id] || 1) + Number(qbtn.dataset.q);
        day.food[id] = next <= 0 ? 0 : Math.min(9, next);
      } else {
        const li = ev.target.closest('li[data-id]');
        if (!li) return;
        day.food[li.dataset.id] = day.food[li.dataset.id] > 0 ? 0 : 1;
      }
      Store.save();
      renderPFC(day);
      renderFoodLists(day);
    });
  }
  bindFoodList('#food-list-default');
  bindFoodList('#food-list-extra');

  /* ---- Training (1日複数種目) ---- */
  function renderTraining(day) {
    const body = $('#training-body');
    const schedule = Store.scheduleFor(currentDayKey);
    if (!schedule || !schedule.items.length || !day.training) {
      body.innerHTML = '<p class="tr-rest">今日は休みの日です</p>';
      return;
    }
    const done = day.training.done;
    let html = '';
    if (schedule.label) html += `<p class="tr-menu-label">${schedule.label}</p>`;
    if (schedule.anyOne) html += '<p class="tr-hint">どちらか1つで達成</p>';
    html += schedule.items.map((item) => {
      const n = done[item.id] || 0;
      const boxes = Array.from({ length: item.sets }, (_, i) =>
        `<button class="tr-box ${i < n ? 'done' : ''}" data-item="${item.id}" data-i="${i}" aria-label="${item.name} セット${i + 1}" aria-pressed="${i < n}"></button>`
      ).join('');
      const target = targetText(item);
      return `<div class="tr-item">` +
        `<div><span class="tr-name">${item.name}</span>${target ? `<span class="tr-target">${target}</span>` : ''}</div>` +
        `<div class="tr-sets">${boxes}<span class="tr-count">${n} / ${item.sets}</span></div>` +
        `</div>`;
    }).join('');
    body.innerHTML = html;
  }
  $('#training-body').addEventListener('click', (ev) => {
    const box = ev.target.closest('.tr-box');
    if (!box) return;
    const i = Number(box.dataset.i);
    const itemId = box.dataset.item;
    const day = Store.ensureDay(currentDayKey);
    const current = day.training.done[itemId] || 0;
    day.training.done[itemId] = i < current ? i : i + 1;
    Store.save();
    renderTraining(day);
  });

  /* ---- 追加食材シート ---- */
  const sheetAdd = $('#sheet-addfood');
  $('#btn-addfood').addEventListener('click', () => {
    for (const id of ['#af-name', '#af-unit', '#af-p', '#af-f', '#af-c']) $(id).value = '';
    $('#addfood-save').disabled = true;
    const recent = Store.recentTemplates(10);
    $('#af-recent-wrap').hidden = recent.length === 0;
    $('#af-recent').innerHTML = recent.map((t) =>
      `<li data-id="${t.id}">${t.name}<span class="pfc-mini">P${t.p} F${t.f} C${t.c}</span></li>`
    ).join('');
    sheetAdd.hidden = false;
  });
  $('#af-name').addEventListener('input', () => {
    $('#addfood-save').disabled = $('#af-name').value.trim() === '';
  });
  $('#addfood-cancel').addEventListener('click', () => { sheetAdd.hidden = true; });
  $('#addfood-save').addEventListener('click', () => {
    const num = (sel) => {
      const v = parseFloat($(sel).value.replace(/[^0-9.]/g, ''));
      return Number.isFinite(v) ? v : 0;
    };
    const t = Store.addTemplate(
      $('#af-name').value.trim(), $('#af-unit').value.trim(),
      num('#af-p'), num('#af-f'), num('#af-c'));
    addToToday(t.id);
  });
  $('#af-recent').addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (li) addToToday(li.dataset.id);
  });
  function addToToday(templateId) {
    const day = Store.ensureDay(currentDayKey);
    // すでにある食材をもう一度追加したら個数 +1
    day.food[templateId] = Math.min(9, (day.food[templateId] || 0) + 1);
    const t = Store.template(templateId);
    if (t) t.lastUsedAt = Date.now();
    Store.save();
    sheetAdd.hidden = true;
    renderToday();
  }

  /* ================= History ================= */

  function renderHistory() {
    updateTopbar();
    document.querySelectorAll('#history-seg .seg').forEach((b) =>
      b.classList.toggle('active', b.dataset.scope === historyScope));
    const body = $('#history-body');
    if (historyScope === 'daily') body.innerHTML = dailyHTML();
    else if (historyScope === 'weekly') body.innerHTML = periodHTML(Store.weekInterval(offsets.weekly), weekTitle());
    else if (historyScope === 'monthly') body.innerHTML = periodHTML(Store.monthInterval(offsets.monthly), monthTitle(offsets.monthly));
    else body.innerHTML = periodHTML(Store.yearInterval(offsets.yearly), yearTitle());
  }

  const periodHead = (title) =>
    `<div class="period-head"><button class="chev" data-nav="-1" aria-label="前の期間">‹</button><h3>${title}</h3><button class="chev" data-nav="1" aria-label="次の期間">›</button></div>`;

  function weekTitle() {
    const { start, end } = Store.weekInterval(offsets.weekly);
    const last = Store.addDays(end, -1);
    return `Week${Store.isoWeek(start)}　${start.getMonth() + 1}/${start.getDate()}〜${last.getMonth() + 1}/${last.getDate()}`;
  }
  function monthTitle(offset) {
    const { start } = Store.monthInterval(offset);
    return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  }
  function yearTitle() {
    return `${Store.yearInterval(offsets.yearly).start.getFullYear()}年`;
  }

  /* ---- 週/月/年 共通サマリー (構成・順序は固定) ---- */
  function periodHTML(interval, title) {
    const keys = Store.keysIn(interval.start, interval.end);
    const trade = Store.tradeSummary(keys);
    const rates = Store.foodRates(keys);
    const training = Store.trainingSummary(keys);
    const sumRow = (label, value, total) =>
      `<div class="sum-row ${total ? 'total' : ''}"><span class="l">${label}</span><span class="v">${value}</span></div>`;
    return periodHead(title) +
      `<section class="card"><h2 class="card-title">Trade</h2>` +
        sumRow('Total', yen(trade.total), true) + '<hr class="sep">' +
        sumRow('Stock', yen(trade.stock)) + sumRow('Future', yen(trade.future)) +
      `</section>` +
      `<section class="card"><h2 class="card-title">Food</h2>` +
        (rates
          ? sumRow('Protein', pct(rates.p)) + sumRow('Fat', pct(rates.f)) + sumRow('Carb', pct(rates.c))
          : '<p class="empty">記録なし</p>') +
      `</section>` +
      `<section class="card"><h2 class="card-title">Training</h2>` +
        sumRow('達成日数', `${training.completed} / ${training.scheduled} 日`) +
      `</section>`;
  }

  /* ---- 日 (カレンダー) ---- */
  function dailyHTML() {
    const { start, end } = Store.monthInterval(offsets.daily);
    const keys = Store.keysIn(start, end);
    const todayK = Store.todayKey();
    const blanks = Store.mondayWeekday(start) - 1;

    let cells = WEEKDAY_JA.map((w) => `<span class="cal-wd">${w}</span>`).join('');
    cells += '<span></span>'.repeat(blanks);
    for (const key of keys) {
      const day = Store.state.days[key];
      const total = day ? day.trade.stock + day.trade.future : 0;
      const cls = ['cal-cell', key === todayK ? 'today' : '', key === selectedCalKey ? 'selected' : ''].join(' ');
      cells += `<button class="${cls}" data-key="${key}">` +
        `<span class="cal-day">${Store.parseKey(key).getDate()}</span>` +
        `<span class="cal-profit">${day && total !== 0 ? compact(total) : ''}</span></button>`;
    }
    return periodHead(monthTitle(offsets.daily)) +
      `<section class="card"><div class="cal-grid">${cells}</div></section>` +
      (selectedCalKey ? dayDetailHTML(selectedCalKey) : '');
  }

  function dayDetailHTML(key) {
    const day = Store.state.days[key];
    const editBtn = key <= Store.todayKey()
      ? `<button class="text-btn-sm" data-edit-day="${key}">この日を入力</button>` : '';
    let html = `<div class="period-head" id="day-detail"><h3>${titleFor(key)}</h3>${editBtn}</div>`;
    if (!day) return html + '<section class="card"><p class="empty">記録なし</p></section>';

    const total = day.trade.stock + day.trade.future;
    html += `<section class="card"><h2 class="card-title">Trade</h2>` +
      `<div class="sum-row total"><span class="l">Total</span><span class="v">${yen(total)}</span></div><hr class="sep">` +
      `<div class="sum-row"><span class="l">Stock</span><span class="v">${yen(day.trade.stock)}</span></div>` +
      `<div class="sum-row"><span class="l">Future</span><span class="v">${yen(day.trade.future)}</span></div></section>`;

    const items = Object.entries(day.food)
      .map(([id, qty]) => ({ t: Store.template(id), qty }))
      .filter((e) => e.t)
      .sort((a, b) => a.t.sortOrder - b.t.sortOrder)
      .map((e) => `<li class="${e.qty > 0 ? '' : 'off'}"><span class="mark">${e.qty > 0 ? '✓' : '−'}</span>${e.t.name}${e.qty > 1 ? ` ×${e.qty}` : ''}</li>`)
      .join('');
    html += `<section class="card"><h2 class="card-title">Food</h2><ul class="detail-food">${items || '<p class="empty">記録なし</p>'}</ul></section>`;

    const schedule = Store.scheduleFor(key);
    const trainingRows = (schedule && schedule.items.length && day.training)
      ? schedule.items.map((item) =>
          `<div class="sum-row"><span class="l">${item.name}</span><span class="v">${day.training.done[item.id] || 0} / ${item.sets}</span></div>`
        ).join('')
      : '<p class="empty">記録なし</p>';
    html += `<section class="card"><h2 class="card-title">Training${schedule && schedule.label ? ` (${schedule.label})` : ''}</h2>${trainingRows}</section>`;
    return html;
  }

  $('#history-body').addEventListener('click', (ev) => {
    const edit = ev.target.closest('[data-edit-day]');
    if (edit) {
      currentDayKey = edit.dataset.editDay;
      selectTab('today');
      return;
    }
    const nav = ev.target.closest('[data-nav]');
    if (nav) {
      offsets[historyScope] += Number(nav.dataset.nav);
      if (historyScope === 'daily') selectedCalKey = null;
      renderHistory();
      return;
    }
    const cell = ev.target.closest('.cal-cell[data-key]');
    if (cell) {
      selectedCalKey = cell.dataset.key === selectedCalKey ? null : cell.dataset.key;
      renderHistory();
      if (selectedCalKey) {
        document.getElementById('day-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  $('#history-seg').addEventListener('click', (ev) => {
    const seg = ev.target.closest('.seg');
    if (!seg) return;
    historyScope = seg.dataset.scope;
    renderHistory();
  });

  /* ================= 設定 ================= */

  const sheetSettings = $('#sheet-settings');
  $('#btn-settings').addEventListener('click', () => {
    const s = Store.state.settings;
    $('#set-p').value = s.proteinTarget;
    $('#set-f').value = s.fatTarget;
    $('#set-c').value = s.carbTarget;
    editingExtraId = null;
    renderExtrasEditor();
    sheetSettings.hidden = false;
  });

  /* ---- 追加食材の編集・削除 ---- */
  let editingExtraId = null;

  function renderExtrasEditor() {
    const extras = Store.state.templates
      .filter((t) => !t.isDefault)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    $('#extras-group').hidden = extras.length === 0;
    $('#extras-list').innerHTML = extras.map((t) => {
      if (t.id === editingExtraId) {
        return `<div class="extra-edit" data-id="${t.id}">` +
          `<div class="form-row"><label>名前</label><input id="ee-name" type="text" value="${esc(t.name)}"></div>` +
          `<div class="form-row"><label>分量</label><input id="ee-unit" type="text" value="${esc(t.unit)}" placeholder="1個 / 100g など"></div>` +
          `<div class="form-row"><label>P (g)</label><input id="ee-p" type="text" inputmode="decimal" value="${t.p}"></div>` +
          `<div class="form-row"><label>F (g)</label><input id="ee-f" type="text" inputmode="decimal" value="${t.f}"></div>` +
          `<div class="form-row"><label>C (g)</label><input id="ee-c" type="text" inputmode="decimal" value="${t.c}"></div>` +
          `<div class="extra-actions">` +
          `<button class="text-btn-sm" data-ee="delete">削除</button>` +
          `<span class="spacer"></span>` +
          `<button class="text-btn-sm" data-ee="cancel">キャンセル</button>` +
          `<button class="text-btn-sm strong" data-ee="save">保存</button>` +
          `</div></div>`;
      }
      const unit = t.unit ? ` <span class="food-unit">${esc(t.unit)}</span>` : '';
      return `<div class="form-row extra-row" data-id="${t.id}" role="button">` +
        `<span>${esc(t.name)}${unit}</span>` +
        `<span class="pfc-mini">P${t.p} F${t.f} C${t.c}</span></div>`;
    }).join('');
  }

  $('#extras-list').addEventListener('click', (ev) => {
    const action = ev.target.closest('[data-ee]');
    if (action) {
      const id = editingExtraId;
      if (action.dataset.ee === 'save') {
        const name = $('#ee-name').value.trim();
        if (!name) return;
        const num = (sel) => {
          const v = parseFloat($(sel).value.replace(/[^0-9.]/g, ''));
          return Number.isFinite(v) ? v : 0;
        };
        Store.updateTemplate(id, {
          name, unit: $('#ee-unit').value.trim(),
          p: num('#ee-p'), f: num('#ee-f'), c: num('#ee-c'),
        });
        editingExtraId = null;
      } else if (action.dataset.ee === 'delete') {
        if (!confirm('この食材を削除します。過去の記録からも消えます。よろしいですか?')) return;
        Store.deleteTemplate(id);
        editingExtraId = null;
      } else {
        editingExtraId = null;
      }
      renderExtrasEditor();
      return;
    }
    const row = ev.target.closest('.extra-row[data-id]');
    if (row) {
      editingExtraId = row.dataset.id;
      renderExtrasEditor();
    }
  });
  $('#settings-done').addEventListener('click', () => {
    const num = (sel, fallback) => {
      const v = parseInt($(sel).value.replace(/[^0-9]/g, ''), 10);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const s = Store.state.settings;
    s.proteinTarget = num('#set-p', s.proteinTarget);
    s.fatTarget = num('#set-f', s.fatTarget);
    s.carbTarget = num('#set-c', s.carbTarget);
    Store.save();
    sheetSettings.hidden = true;
    render();
  });

  /* ---- バックアップ ---- */
  function download(filename, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('#btn-export-json').addEventListener('click', () =>
    download(`day-backup-${Store.todayKey()}.json`, Store.exportJSON(), 'application/json'));
  $('#btn-export-csv').addEventListener('click', () =>
    download(`day-trade-${Store.todayKey()}.csv`, Store.exportCSV(), 'text/csv'));
  $('#btn-import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (confirm('現在のデータをバックアップの内容で置き換えます。よろしいですか?')) {
        Store.importJSON(text);
        render();
        alert('読み込みました');
      }
    } catch (e) {
      alert('読み込めませんでした: ' + e.message);
    }
    ev.target.value = '';
  });

  /* ================= タブ・起動 ================= */

  function selectTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabbar .tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tab));
    $('#view-today').hidden = tab !== 'today';
    $('#view-history').hidden = tab !== 'history';
    render();
  }
  document.querySelectorAll('.tabbar .tab').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  function render() {
    if (currentTab === 'today') renderToday();
    else renderHistory();
  }

  // 日付が変わっていたら新しい日へ移る (0時自動生成に相当)。
  // 過去日を編集中の場合はその日に留まる。
  let knownToday = Store.todayKey();
  function rolloverIfNeeded() {
    const key = Store.todayKey();
    if (key !== knownToday) {
      const wasOnToday = currentDayKey === knownToday;
      knownToday = key;
      if (wasOnToday) currentDayKey = key;
      selectedCalKey = null;
      render();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) rolloverIfNeeded();
  });
  window.addEventListener('pageshow', rolloverIfNeeded);

  // 別タブ/別ウィンドウがデータを書き換えたら読み直す (iPhone 単体では発火しない)
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'day-app-state-v1') location.reload();
  });

  // 入力欄の外をタップしたらキーボードを閉じる (iOS の数字キーボードには完了ボタンがないため)
  document.addEventListener('pointerdown', (ev) => {
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT' && !ev.target.closest('input')) {
      active.blur();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  render();
})();
