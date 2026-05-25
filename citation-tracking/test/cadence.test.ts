// citation-tracking/test/cadence.test.ts
// F4.1 smoke harness -- JS function tests for computeNextProbeAt.
// Invoked via: npx tsx test/cadence.test.ts

import { computeNextProbeAt } from '../src/cadence';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`PASS: ${name}`);
    passCount++;
  } else {
    console.log(`FAIL: ${name}`);
    failCount++;
  }
}

// Case 2: daily Mon 02:00 UTC -> Tue 02:00
{
  const mon = new Date(Date.UTC(2026, 4, 25, 2, 0, 0));
  const next = computeNextProbeAt('daily', mon);
  const expected = Math.floor(Date.UTC(2026, 4, 26, 2, 0, 0) / 1000);
  assert(next === expected, 'case2 daily Mon->Tue');
}

// Case 3: twice_weekly Mon 02:00 UTC -> Thu 02:00
{
  const mon = new Date(Date.UTC(2026, 4, 25, 2, 0, 0));
  const next = computeNextProbeAt('twice_weekly', mon);
  const expected = Math.floor(Date.UTC(2026, 4, 28, 2, 0, 0) / 1000);
  assert(next === expected, 'case3 twice_weekly Mon->Thu');
}

// Case 4: twice_weekly Thu 02:00 UTC -> next Mon (wrap)
{
  const thu = new Date(Date.UTC(2026, 4, 28, 2, 0, 0));
  const next = computeNextProbeAt('twice_weekly', thu);
  const expected = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  assert(next === expected, 'case4 twice_weekly Thu->next-Mon-wrap');
}

// Case 5: twice_weekly Sun 18:00 UTC -> Mon 02:00
{
  const sun = new Date(Date.UTC(2026, 4, 24, 18, 0, 0));
  const next = computeNextProbeAt('twice_weekly', sun);
  const expected = Math.floor(Date.UTC(2026, 4, 25, 2, 0, 0) / 1000);
  assert(next === expected, 'case5 twice_weekly Sun->Mon');
}

// Case 6: twice_weekly Wed 23:00 UTC -> Thu 02:00
{
  const wed = new Date(Date.UTC(2026, 4, 27, 23, 0, 0));
  const next = computeNextProbeAt('twice_weekly', wed);
  const expected = Math.floor(Date.UTC(2026, 4, 28, 2, 0, 0) / 1000);
  assert(next === expected, 'case6 twice_weekly Wed->Thu');
}

console.log(`=== cadence ts-tests: ${passCount} PASS, ${failCount} FAIL ===`);
if (failCount > 0) process.exit(1);
