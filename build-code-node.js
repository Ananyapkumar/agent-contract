'use strict';

// Generates n8n-code-node.js from check.js.
// One source of truth: edit check.js, run this, never hand-edit the output.

const fs = require('fs');

const source = fs.readFileSync('./check.js', 'utf8');

// Strip the two things the n8n sandbox does not allow.
const core = source
  .replace(/^'use strict';\s*/, '')
  .replace(/module\.exports\s*=.*;?\s*$/m, '')
  .trim();

const header = `// =====================================================================
// agent-contract v0.1.1  —  paste this into an n8n Code node
// placed immediately AFTER your AI Agent node.
//
// GENERATED FILE. Do not edit by hand.
// Edit check.js in the repo, then run: node build-code-node.js
//
// https://github.com/Ananyapkumar/agent-contract
// =====================================================================

// ---------------------------------------------------------------------
// 1. YOUR CONTRACT — edit this to match your workflow.
// ---------------------------------------------------------------------
const contract = {
  format: 'json',                                  // 'json' or 'text'
  requiredKeys: ['customer_name', 'priority'],     // fields you need
  mustCallTools: ['get_customer_record'],          // tools that MUST run
  collectionTools: [],                             // tools that return lists
  forbidPlaceholders: true,
};

// Set true to make this node THROW when a check fails, so n8n marks the
// execution as failed and your error workflow actually fires.
//
// Left false, this node stays green and you must branch on contractOk
// with an IF node. That works, but it is a step people forget — and a
// checker that fails silently has the same problem it was built to catch.
const throwOnFail = false;

// ---------------------------------------------------------------------
// 2. THE CHECKS — no need to edit below this line.
// ---------------------------------------------------------------------
`;

const footer = `
// ---------------------------------------------------------------------
// 3. RUN IT over every item coming from the agent.
// ---------------------------------------------------------------------
const checked = $input.all().map((item) => {
  const result = checkOutput(item.json, contract);
  return {
    json: {
      ...item.json,
      contractOk: result.ok,
      contractFailures: result.failures,
    },
  };
});

if (throwOnFail) {
  const bad = checked.filter((i) => !i.json.contractOk);
  if (bad.length > 0) {
    const reasons = bad
      .flatMap((i) => i.json.contractFailures.map((f) => f.check))
      .join(', ');
    throw new Error(
      \`Agent output failed contract on \${bad.length} item(s): \${reasons}\`
    );
  }
}

return checked;
`;

fs.writeFileSync('./n8n-code-node.js', header + core + '\n' + footer);

const lines = (header + core + footer).split('\n').length;
console.log(`Generated n8n-code-node.js (${lines} lines)`);
