const { test } = require('node:test');
const assert = require('node:assert');

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = { getElementById() { return null; } };

const week = require('../app/js/view-week.js');

test('dragPreview: 预览位置按鼠标位移计算并钳在网格范围内', () => {
  assert.deepStrictEqual(week.dragPreview({ top: 120, delta: 35, height: 90, total: 912 }), {
    top: 155,
    delta: 35
  });
  assert.deepStrictEqual(week.dragPreview({ top: 120, delta: -200, height: 90, total: 912 }), {
    top: 0,
    delta: -120
  });
  assert.deepStrictEqual(week.dragPreview({ top: 120, delta: 900, height: 90, total: 912 }), {
    top: 822,
    delta: 702
  });
});
