(function () {
  'use strict';
  const PB = (globalThis.PB = globalThis.PB || {});
  const store = PB.store;
  const util = PB.util;
  let editingId = null;
  function monthAdd(ym, n) {
    const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function defaultRange() {
    const now = new Date(); const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { from, to: monthAdd(from, 5) };
  }
  function setRange() {
    const from = document.getElementById('timelineRangeFrom').value;
    const to = document.getElementById('timelineRangeTo').value;
    const year = new Date().getFullYear(); const minMonth = `${year}-01`; const maxMonth = `${year + 2}-12`;
    if (from < minMonth || to < minMonth || from > maxMonth || to > maxMonth) { PB.list.showToast(`显示范围只能在今年至 ${year + 2} 年内`); return; }
    if (!from || !to || from > to) { PB.list.showToast('时间轴范围无效'); return; }
    const st = store.get(); st.config.timelineStart = from; st.config.timelineEnd = to; store.save(); render();
  }

  function showForm(item) {
    editingId = item ? item.id : null;
    const f = document.getElementById('timelineForm');
    f.style.display = '';
    document.getElementById('timelineTitle').value = item?.title || '';
    document.getElementById('timelineFrom').value = item?.from || util.todayStr();
    document.getElementById('timelineFrom').min = `${new Date().getFullYear()}-01-01`;
    document.getElementById('timelineNote').value = item?.note || '';
    document.getElementById('timelineColor').value = item?.color || '#3b82f6';
    document.getElementById('timelineImportant').checked = item?.important !== false;
    document.getElementById('timelineTitle').focus();
  }
  function hideForm() { editingId = null; document.getElementById('timelineForm').style.display = 'none'; }
  function save() {
    const title = document.getElementById('timelineTitle').value.trim();
    const from = document.getElementById('timelineFrom').value;
    if (!title || !from) { PB.list.showToast('请填写节点名称和日期'); return; }
    if (from < `${new Date().getFullYear()}-01-01`) { PB.list.showToast('节点日期不能早于今年'); return; }
    const st = store.get();
    const list = st.timeline || (st.timeline = []);
    const item = { id: editingId || ('m_' + Date.now().toString(36)), title, from, to: from,
      note: document.getElementById('timelineNote').value.trim(),
      color: document.getElementById('timelineColor').value,
      important: document.getElementById('timelineImportant').checked };
    const i = list.findIndex(x => x.id === editingId);
    if (i < 0) list.push(item); else list[i] = item;
    store.save(); hideForm(); render();
  }
  function remove(id) {
    const list = store.get().timeline || [];
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) { list.splice(i, 1); store.save(); render(); }
  }
  function render() {
    const board = document.getElementById('timelineBoard'); if (!board) return;
    const configured = store.get().config || {}; const def = defaultRange();
    const rangeFrom = document.getElementById('timelineRangeFrom')?.value || configured.timelineStart || def.from;
    const rangeTo = document.getElementById('timelineRangeTo')?.value || configured.timelineEnd || def.to;
    const fromDate = rangeFrom + '-01';
    const toDate = monthAdd(rangeTo, 1) + '-01';
    const fromEl = document.getElementById('timelineRangeFrom'); const toEl = document.getElementById('timelineRangeTo');
    const year = new Date().getFullYear(); const minMonth = `${year}-01`; const maxMonth = `${year + 2}-12`;
    if (fromEl) { fromEl.min = minMonth; fromEl.max = maxMonth; fromEl.value = rangeFrom; }
    if (toEl) { toEl.min = minMonth; toEl.max = maxMonth; toEl.value = rangeTo; }
    const list = (store.get().timeline || []).slice().sort((a, b) => String(a.from).localeCompare(String(b.from)));
    const min = fromDate; const max = util.addDays(toDate, -1);
    const total = Math.max(1, util.daysBetween(min, max) + 1);
    const ticks = [];
    const years = [];
    for (let ym = rangeFrom, i = 0; ym <= rangeTo; ym = monthAdd(ym, 1), i++) {
      const pct = util.daysBetween(min, ym + '-01') / total * 100;
      const displayPct = 3 + pct * 0.94;
      const [yy, mm] = ym.split('-');
      ticks.push(`<span style="left:${displayPct}%">${Number(mm)}月</span>`);
      if (i === 0 || mm === '01') years.push(`<span class="timeline-year" style="left:${displayPct}%">${yy}年</span><i class="timeline-year-line" style="left:${displayPct}%"></i>`);
    }
    const lanes = { above: [], below: [] };
    const assignments = list.map((x, idx) => {
      const date = x.from || x.to;
      const left = Math.max(0, util.daysBetween(min, date)) / total * 100;
      let side = idx % 2 ? 'below' : 'above';
      let lane = lanes[side].findIndex(last => Math.abs(left - last) >= 14);
      if (lane < 0) { const other = side === 'above' ? 'below' : 'above'; const n = lanes[other].findIndex(last => Math.abs(left - last) >= 14); if (n >= 0) { side = other; lane = n; } else lane = lanes[side].length; }
      lanes[side][lane] = left;
      return { x, date, left, side, lane };
    });
    const axisHeight = Math.max(250, 180 + Math.max(lanes.above.length, lanes.below.length) * 164);
    board.innerHTML = `<div class="timeline-axis-wrap"><div class="timeline-years">${years.join('')}</div><div class="timeline-scale">${ticks.join('')}</div><div class="timeline-axis" style="--axis-height:${axisHeight}px">${assignments.map(({x, date, left, side, lane}) => {
      const daysAway = util.daysBetween(util.todayStr(), date);
      const color = daysAway < 0 ? '#94a3b8' : daysAway <= 14 ? '#f97316' : (x.color || '#3b82f6');
      const weight = x.important === false ? '' : ' important';
      return `<div class="timeline-point ${side}${weight}" style="left:${left}%;--lane:${lane}"><div class="timeline-card" style="border-color:${util.attr(color)}" title="${util.attr(x.note || '')}"><b>${util.escapeHtml(x.title)}</b><small>${util.escapeHtml(date)}</small>${x.note ? `<em>${util.escapeHtml(x.note)}</em>` : ''}<span class="timeline-actions"><button onclick="PB.timeline.edit('${util.attr(x.id)}')">编辑</button><button onclick="PB.timeline.remove('${util.attr(x.id)}')">×</button></span></div><i class="timeline-stem" style="background:${util.attr(color)}"></i><i class="timeline-dot" style="background:${util.attr(color)}"></i></div>`;
    }).join('')}</div></div>`;
  }
  const api = { render, showForm, hideForm, save, remove, setRange, edit: id => showForm((store.get().timeline || []).find(x => x.id === id)) };
  PB.timeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
