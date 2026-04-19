import { shouldPackExtraction } from '../analyze.js';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

check(
  'packs extraction with symbols',
  shouldPackExtraction({ symbols: [{}], refs: [] }),
);

check(
  'packs extraction with refs only',
  shouldPackExtraction({ symbols: [], refs: [{}] }),
);

check(
  'skips extraction with no symbols and no refs',
  !shouldPackExtraction({ symbols: [], refs: [] }),
);

console.log(`\nAnalyze command smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
