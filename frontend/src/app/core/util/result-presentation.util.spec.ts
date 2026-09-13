import { EN_STRINGS } from '../i18n/en';
import { buildIdentificationPresentation } from './result-presentation.util';

describe('buildIdentificationPresentation', () => {
  it('maps A, B, and C to safe human-readable labels without raw identifiers', () => {
    const a = buildIdentificationPresentation('A_WELL_IDENTIFIED');
    expect(a.label).toBe(EN_STRINGS.results.identificationWellIdentified);
    expect(a.body.toLowerCase()).toContain('optimization surface');
    expect(a.label).not.toContain('A_WELL_IDENTIFIED');

    const b = buildIdentificationPresentation('B_WEAKLY_IDENTIFIED');
    expect(b.label).toBe(EN_STRINGS.results.identificationWeaklyIdentified);
    expect(b.label).not.toContain('B_WEAKLY_IDENTIFIED');

    const c = buildIdentificationPresentation('C_NOT_IDENTIFIED');
    expect(c.label).toBe(EN_STRINGS.results.identificationNotIdentified);
    expect(c.label).not.toContain('C_NOT_IDENTIFIED');
  });

  it('renders Not available for unknown and missing values', () => {
    expect(buildIdentificationPresentation('Z_INTERNAL_UNKNOWN').label).toBe(
      EN_STRINGS.common.notAvailable,
    );
    expect(buildIdentificationPresentation(undefined).label).toBe(EN_STRINGS.common.notAvailable);
    expect(buildIdentificationPresentation(null).label).toBe(EN_STRINGS.common.notAvailable);
    expect(buildIdentificationPresentation('').label).toBe(EN_STRINGS.common.notAvailable);
  });
});
