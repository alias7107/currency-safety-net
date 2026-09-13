import {
  findMinimumTestedBufferMeetingThreshold,
  parseCvarThresholdInput,
  parseProbabilityPercentInput,
  sortBufferRowsAscending,
} from './target-finder.util';
import { BUFFER_SENSITIVITY_RESULT } from '../../testing/buffer-sensitivity.fixtures';

describe('target-finder.util', () => {
  it('sorts buffers ascending without mutating the source', () => {
    const reversed = [...BUFFER_SENSITIVITY_RESULT.results].reverse();
    const sorted = sortBufferRowsAscending(reversed);
    expect(sorted.map((row) => row.buffer_months)).toEqual([1, 3, 6, 12]);
    expect(reversed.map((row) => row.buffer_months)).toEqual([12, 6, 3, 1]);
  });

  it('selects the first qualifying tested buffer and treats equality as meeting the threshold', () => {
    const found = findMinimumTestedBufferMeetingThreshold(
      BUFFER_SENSITIVITY_RESULT,
      'shortfall_probability',
      0.1,
    );
    expect(found.status).toBe('found');
    if (found.status === 'found') {
      expect(found.bufferMonths).toBe(3);
      expect(found.metricValue).toBe(0.1);
    }
  });

  it('reports when no tested buffer meets the threshold', () => {
    const none = findMinimumTestedBufferMeetingThreshold(
      BUFFER_SENSITIVITY_RESULT,
      'cvar95_cumulative_shortfall',
      0.1,
    );
    expect(none.status).toBe('none');
  });

  it('converts percentage input to [0,1] and rejects invalid thresholds', () => {
    expect(parseProbabilityPercentInput('10')).toEqual({ ok: true, value: 0.1 });
    expect(parseProbabilityPercentInput('')).toEqual({ ok: false, reason: 'blank' });
    expect(parseProbabilityPercentInput('-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parseProbabilityPercentInput('101')).toEqual({ ok: false, reason: 'above_100' });
    expect(parseProbabilityPercentInput('abc').ok).toBe(false);

    expect(parseCvarThresholdInput('1.2')).toEqual({ ok: true, value: 1.2 });
    expect(parseCvarThresholdInput('-0.1')).toEqual({ ok: false, reason: 'negative' });
    expect(
      findMinimumTestedBufferMeetingThreshold(
        BUFFER_SENSITIVITY_RESULT,
        'shortfall_probability',
        1.5,
      ).status,
    ).toBe('invalid_threshold');
  });

  it('never invents interpolated buffer months', () => {
    const found = findMinimumTestedBufferMeetingThreshold(
      BUFFER_SENSITIVITY_RESULT,
      'cvar95_cumulative_shortfall',
      1.5,
    );
    expect(found.status).toBe('found');
    if (found.status === 'found') {
      expect([1, 3, 6, 12]).toContain(found.bufferMonths);
      expect(found.bufferMonths).not.toBe(2);
      expect(found.bufferMonths).not.toBe(4.5);
    }
  });
});
