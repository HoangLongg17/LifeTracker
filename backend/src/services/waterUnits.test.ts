
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { convertWaterToMl } from './waterUnits';

describe('LIFE-40 - Quy đổi nước uống', () => {
  it('250 mL giữ nguyên 250 mL', () => {
    assert.deepEqual(
      convertWaterToMl(250, 'mL'),
      { ok: true, volumeMl: 250 }
    );
  });

  it('0,5 L bằng 500 mL', () => {
    assert.deepEqual(
      convertWaterToMl(0.5, 'L'),
      { ok: true, volumeMl: 500 }
    );
  });

  it('250 mL + 0,5 L bằng 750 mL', () => {
    const first = convertWaterToMl(250, 'mL');
    const second = convertWaterToMl(0.5, 'L');

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    if (first.ok && second.ok) {
      assert.equal(
        first.volumeMl + second.volumeMl,
        750
      );
    }
  });

  it('Từ chối lượng nước bằng 0', () => {
    assert.equal(
      convertWaterToMl(0, 'mL').ok,
      false
    );
  });

  it('Từ chối lượng nước âm', () => {
    assert.equal(
      convertWaterToMl(-100, 'mL').ok,
      false
    );
  });

  it('Từ chối đơn vị không hỗ trợ', () => {
    assert.equal(
      convertWaterToMl(1, 'cup').ok,
      false
    );
  });

  it('Từ chối giá trị Infinity', () => {
    assert.equal(
      convertWaterToMl(Infinity, 'L').ok,
      false
    );
  });
});
