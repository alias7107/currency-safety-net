import {
  buildDiagnosticMetricViews,
  buildIdentificationPresentation,
  buildProvenanceDetailRows,
  buildReportProvenanceRows,
  formatCvar95Value,
} from './result-presentation.util';
import { EN_STRINGS } from '../i18n/en';
import { OPTIMIZATION_RESULT } from '../../testing/fixtures';

describe('result-presentation.util', () => {
  it('formats CVaR95 and builds diagnostics without inventing metrics', () => {
    expect(formatCvar95Value(OPTIMIZATION_RESULT)).toContain('0.86');
    const diagnostics = buildDiagnosticMetricViews(OPTIMIZATION_RESULT);
    expect(diagnostics.map((item) => item.key)).toEqual([
      'shortfall_probability',
      'var95_cumulative_shortfall',
      'mean_cumulative_shortfall',
      'wealth_depletion_probability',
    ]);
    expect(diagnostics.every((item) => item.howToRead.length > 0)).toBe(true);
  });

  it('adds a zero-VaR note only when VaR95 is zero', () => {
    expect(buildDiagnosticMetricViews(OPTIMIZATION_RESULT)[1]?.note).toBeNull();
    const zero = buildDiagnosticMetricViews({
      ...OPTIMIZATION_RESULT,
      var95_cumulative_shortfall: 0,
    });
    expect(zero[1]?.note).toBe(EN_STRINGS.results.phase2b.diagnostics.var95.zeroNote);
  });

  it('maps only the documented identification class to a public label', () => {
    expect(buildIdentificationPresentation('A_WELL_IDENTIFIED')?.label).toBe(
      EN_STRINGS.results.identificationWellIdentified,
    );
    expect(buildIdentificationPresentation('Z_WEIRD')?.label).toBe(EN_STRINGS.common.notAvailable);
    expect(buildIdentificationPresentation('Z_WEIRD')?.label).not.toContain('Z_WEIRD');
    expect(buildIdentificationPresentation(null)).toBeNull();
  });

  it('omits optional grid counts when absent and includes them when present', () => {
    const without = buildReportProvenanceRows(
      {
        ...OPTIMIZATION_RESULT,
        n_coarse: undefined,
        n_refined: undefined,
        n_surface: undefined,
      },
      'job-1',
    );
    expect(without.some((row) => row.key === 'n_coarse')).toBe(false);
    expect(without.some((row) => row.key === 'job_id')).toBe(true);

    const withGrid = buildProvenanceDetailRows({
      ...OPTIMIZATION_RESULT,
      n_coarse: 3,
      n_refined: 4,
      n_surface: 5,
    });
    expect(withGrid.find((row) => row.key === 'n_surface')?.value).toBe('5');
  });
});
