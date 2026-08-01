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
  forbidPlaceholders: true,
};

// ---------------------------------------------------------------------
// 2. THE CHECKS — no need to edit below this line.
// ---------------------------------------------------------------------
`;

const footer = `
// ---------------------------------------------------------------------
// 3. RUN IT over every item coming from the agent.
// ---------------------------------------------------------------------
return $input.all().map((item) => {
  const result = checkOutput(item.json, contract);
  return {
    json: {
      ...item.json,
      contractOk: result.ok,
      contractFailures: result.failures,
    },
  };
});
`;

fs.writeFileSync('./n8n-code-node.js', header + core + '\n' + footer);

const lines = (header + core + footer).split('\n').length;
console.log(`Generated n8n-code-node.js (${lines} lines)`);
