'use strict';

const fs = require('fs');
const path = require('path');
const { checkOutput, CHECKS } = require('./check');

const contract = JSON.parse(fs.readFileSync('./contract.example.json', 'utf8'));
const expected = JSON.parse(fs.readFileSync('./fixtures/expected.json', 'utf8'));

// Only grade against checks that exist right now. As you add checks,
// more of the spec switches on automatically.
const implemented = CHECKS.map((c) => c.name);

console.log(`\nChecks implemented: ${implemented.join(', ')}`);
console.log('='.repeat(64));

let passed = 0;
let failed = 0;

for (const [file, spec] of Object.entries(expected)) {
  if (file.startsWith('_')) continue; // skip the _comment key

  // A spec is either a plain array of check names, or an object that
  // also names a different contract file for this fixture.
  const allExpected = Array.isArray(spec) ? spec : spec.fails;
  const activeContract = Array.isArray(spec) || !spec.contract
    ? contract
    : JSON.parse(fs.readFileSync('./' + spec.contract, 'utf8'));

  const data = JSON.parse(
    fs.readFileSync(path.join('fixtures', file), 'utf8')
  );
  const result = checkOutput(data, activeContract);

  const want = allExpected.filter((n) => implemented.includes(n)).sort();
  const got = result.failures.map((f) => f.check).sort();

  const isMatch = JSON.stringify(want) === JSON.stringify(got);
  isMatch ? passed++ : failed++;

  console.log(`${isMatch ? 'PASS' : 'FAIL'}  ${file.padEnd(20)}`);
  console.log(`      expected: [${want.join(', ')}]`);
  console.log(`      actual:   [${got.join(', ')}]`);
  for (const f of result.failures) {
    console.log(`        - ${f.message}`);
  }
  console.log('');
}

console.log('='.repeat(64));
console.log(`${passed} passed, ${failed} failed\n`);

process.exit(failed === 0 ? 0 : 1);
