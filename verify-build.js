'use strict';

// Proves the GENERATED code node behaves like the tested source.
// Without this, check.js and n8n-code-node.js can silently diverge and
// your test suite stops testing what people actually paste.

const fs = require('fs');

const generated = fs.readFileSync('./n8n-code-node.js', 'utf8');

const cases = [
  { fixture: 'real-phantom-tool.json', contract: 'contract.calculator.json',          expectOk: false },
  { fixture: 'real-good.json',         contract: 'contract.calculator-notools.json',  expectOk: true  },
  { fixture: 'good.json',              contract: 'contract.example.json',             expectOk: true  },
  { fixture: 'malformed.json',         contract: 'contract.example.json',             expectOk: false },
];

let failed = 0;

for (const c of cases) {
  const data = JSON.parse(fs.readFileSync(`./fixtures/${c.fixture}`, 'utf8'));
  const contract = fs.readFileSync(`./${c.contract}`, 'utf8');

  const patched = generated.replace(
    /const contract = \{[\s\S]*?\};/,
    `const contract = ${contract.trim()};`
  );

  const $input = { all: () => [{ json: data }] };
  const out = new Function('$input', patched)($input);
  const ok = out[0].json.contractOk;

  const good = ok === c.expectOk;
  if (!good) failed++;
  console.log(
    `${good ? 'PASS' : 'FAIL'}  ${c.fixture.padEnd(24)} contractOk=${ok} (expected ${c.expectOk})`
  );
}

console.log(`\n${failed === 0 ? 'Build verified.' : failed + ' MISMATCH(ES)'}\n`);
process.exit(failed === 0 ? 0 : 1);
