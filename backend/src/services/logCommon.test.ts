
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  validEntryId,
  validTimeZone,
  localDate,
  isRecord,
} from './logCommon';

describe('LIFE-39 - Shared log utilities', () => {
  it('accepts valid entryId', () => {
    assert.equal(validEntryId('water_001'), true);
    assert.equal(validEntryId('log-123'), true);
  });

  it('rejects invalid entryId', () => {
    assert.equal(validEntryId(''), false);
    assert.equal(validEntryId('bad/id'), false);
    assert.equal(validEntryId('abc def'), false);
  });

  it('validates IANA timeZone', () => {
    assert.equal(
      validTimeZone('Asia/Ho_Chi_Minh'),
      true
    );

    assert.equal(
      validTimeZone('Invalid/Zone'),
      false
    );
  });

  it('calculates localDate correctly', () => {
    const date = new Date(
      '2026-11-21T17:30:00.000Z'
    );

    assert.equal(
      localDate(date, 'Asia/Ho_Chi_Minh'),
      '2026-11-22'
    );
  });

  it('rejects non-object values', () => {
    assert.equal(isRecord(null), false);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord({}), true);
  });
});
