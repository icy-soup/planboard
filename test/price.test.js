const { test } = require('node:test');
const assert = require('node:assert');
const util = require('../app/js/util.js');
const price = require('../app/js/price.js');

// 2026-09-19 周六、09-20 周日、09-21 周一（非节假日）

test('isPeak: 工作日 9-12 / 14-18 为高峰', () => {
  assert.strictEqual(price.isPeak('2026-09-21', '09:00'), true);
  assert.strictEqual(price.isPeak('2026-09-21', '11:59'), true);
  assert.strictEqual(price.isPeak('2026-09-21', '12:00'), false);   // 午休
  assert.strictEqual(price.isPeak('2026-09-21', '14:00'), true);
  assert.strictEqual(price.isPeak('2026-09-21', '17:59'), true);
  assert.strictEqual(price.isPeak('2026-09-21', '18:00'), false);
  assert.strictEqual(price.isPeak('2026-09-21', '08:59'), false);
});

test('isOffPeakDay: 周末全天空闲', () => {
  assert.strictEqual(price.isOffPeakDay('2026-09-19'), true);   // 周六
  assert.strictEqual(price.isOffPeakDay('2026-09-20'), true);   // 周日
  assert.strictEqual(price.isPeak('2026-09-19', '10:00'), false);
});

test('isOffPeakDay: 法定节假日全天空闲（即使是工作日）', () => {
  assert.strictEqual(price.isHoliday('2026-10-01'), true);      // 国庆节（周四）
  assert.strictEqual(price.isOffPeakDay('2026-10-01'), true);
  assert.strictEqual(price.isPeak('2026-10-01', '10:00'), false);
});

test('isOffPeakDay: 普通工作日不是空闲日', () => {
  assert.strictEqual(price.isHoliday('2026-09-21'), false);
  assert.strictEqual(price.isOffPeakDay('2026-09-21'), false);
});

test('春节四天（除夕到初三）都算法定节假日', () => {
  for (const d of ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19']) {
    assert.strictEqual(price.isHoliday(d), true, d);
  }
});

test('未维护的年份不误判为节假日', () => {
  assert.strictEqual(price.isHoliday('2027-01-01'), false);
  assert.strictEqual(util.dayOfWeek('2026-09-19'), 6);          // 校验周日=7 口径
});
