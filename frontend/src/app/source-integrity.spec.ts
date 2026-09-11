import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard: shipped UI source must not embed published research outputs.
 * Behavioural chart tests live with AllocationChart; this file only scans disk.
 *
 * Specs and `testing/` fixtures are excluded so test doubles may use known dates
 * or allocations without failing the integrity scan.
 */
describe('UI source integrity', () => {
  const FORBIDDEN_LITERALS = [
    '1.1871802686857733',
    '0.5082906243903793',
    '0.0491',
    '0.0283',
    '1486',
    '1473',
    '1409',
    '1403',
    '1326',
    '2025-12-31',
  ];

  /** Published all-KZT optimum as a TypeScript / HTML array literal. */
  const WEIGHT_VECTOR = /\[\s*1(?:\.0+)?\s*,\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*\]/;

  const sourceFiles = collectShippedSourceFiles(join('src', 'app'));

  it('scans a non-trivial number of shipped source files', () => {
    expect(sourceFiles.length).toBeGreaterThan(15);
  });

  it('contains no canonical research outputs, data-as-of date, or literal weight vector', () => {
    const offences: string[] = [];

    for (const file of sourceFiles) {
      const contents = readFileSync(file, 'utf-8');
      for (const literal of FORBIDDEN_LITERALS) {
        if (contents.includes(literal)) {
          offences.push(`${file}: literal "${literal}"`);
        }
      }
      if (WEIGHT_VECTOR.test(contents)) {
        offences.push(`${file}: literal weight vector`);
      }
    }

    expect(offences).toEqual([]);
  });
});

/** Recursively collect `.ts` / `.html` under `root`, skipping specs and fixtures. */
function collectShippedSourceFiles(root: string): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'testing') {
          continue;
        }
        walk(full);
        continue;
      }
      if (full.endsWith('.spec.ts')) {
        continue;
      }
      if (full.endsWith('.ts') || full.endsWith('.html')) {
        out.push(full);
      }
    }
  };

  walk(root);
  return out;
}
