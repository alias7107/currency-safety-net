import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatInteger,
  formatMonthsOfIncome,
  formatPercent,
  formatRatio,
  formatRebalanceFrequency,
  formatWeight,
  humanizeIdentificationClass,
  interpolate,
  profileIdFromName,
} from './format.util';

// Scenario 18: metric formatting
describe('format.util', () => {
  describe('formatPercent', () => {
    it('renders a proportion as a percentage', () => {
      expect(formatPercent(0.0734, 2)).toBe('7.34%');
      expect(formatPercent(0.0491, 2)).toBe('4.91%');
      expect(formatPercent(0.5)).toBe('50%');
      expect(formatPercent(1)).toBe('100%');
      expect(formatPercent(0)).toBe('0%');
    });

    it('never reports a non-zero modelled risk as zero', () => {
      expect(formatPercent(0.00004, 2)).toBe('<0.01%');
      expect(formatPercent(0.0004, 1)).toBe('<0.1%');
    });

    it('returns a dash for missing or non-finite values', () => {
      expect(formatPercent(null)).toBe('—');
      expect(formatPercent(undefined)).toBe('—');
      expect(formatPercent(Number.NaN)).toBe('—');
    });
  });

  describe('formatWeight', () => {
    it('formats allocation weights to one decimal at most', () => {
      expect(formatWeight(0.62)).toBe('62%');
      expect(formatWeight(0.275)).toBe('27.5%');
      expect(formatWeight(0)).toBe('0%');
      expect(formatWeight(1)).toBe('100%');
    });
  });

  describe('formatMonthsOfIncome', () => {
    it('formats normalized shortfall values to two decimals', () => {
      expect(formatMonthsOfIncome(0.8642)).toBe('0.86');
      expect(formatMonthsOfIncome(0)).toBe('0.00');
      expect(formatMonthsOfIncome(12.3456)).toBe('12.35');
    });

    it('returns a dash when the model did not report the metric', () => {
      expect(formatMonthsOfIncome(undefined)).toBe('—');
    });
  });

  it('formats ratios, integers, horizons and buffers', () => {
    expect(formatRatio(0.95)).toBe('0.95');
    expect(formatRatio(1.05)).toBe('1.05');
    expect(formatInteger(10000)).toBe('10,000');
    expect(formatHorizon(1)).toBe('1 year');
    expect(formatHorizon(3)).toBe('3 years');
    expect(formatBufferMonths(1)).toBe('1 month');
    expect(formatBufferMonths(12)).toBe('12 months');
  });

  it('formats conversion cost as a percentage of the converted amount', () => {
    expect(formatConversionCost(0)).toBe('0%');
    expect(formatConversionCost(0.0025)).toBe('0.25%');
    expect(formatConversionCost(0.01)).toBe('1%');
  });

  it('formats every documented rebalance frequency for display', () => {
    expect(formatRebalanceFrequency('monthly')).toBe('Monthly');
    expect(formatRebalanceFrequency('quarterly')).toBe('Quarterly');
    expect(formatRebalanceFrequency('none')).toBe('No rebalancing');
    expect(formatRebalanceFrequency('weekly')).toBe('Weekly');
    expect(formatRebalanceFrequency(null)).toBe('—');
  });

  it('extracts the public profile id from the internal engine name', () => {
    expect(profileIdFromName('P2_foreign_income_mismatch')).toBe('P2');
    expect(profileIdFromName('P4_full_multi_currency')).toBe('P4');
    expect(profileIdFromName('P1')).toBe('P1');
    expect(profileIdFromName(undefined)).toBeNull();
  });

  it('humanizes the identification class for secondary display', () => {
    expect(humanizeIdentificationClass('A_WELL_IDENTIFIED')).toBe('A Well Identified');
    expect(humanizeIdentificationClass(null)).toBe('—');
  });

  it('interpolates named placeholders in centralised copy', () => {
    expect(interpolate('Data as of {dataAsOf}', { dataAsOf: '2025-12-31' })).toBe(
      'Data as of 2025-12-31',
    );
    expect(interpolate('{a} and {b}', { a: 1, b: 2 })).toBe('1 and 2');
    expect(interpolate('{missing}', {})).toBe('{missing}');
  });
});
