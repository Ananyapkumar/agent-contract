'use strict';

// =====================================================================
// STEP 1 — CONTEXT
// Parse and normalise the agent output ONCE. Every check reads from
// this object instead of re-parsing. If parsing fails, `parsed` stays
// null and checks that need it bail out quietly.
// =====================================================================
function buildContext(agentOutput, contract) {
  const raw = typeof agentOutput.output === 'string' ? agentOutput.output : '';
  const trimmed = raw.trim();

  let parsed = null;
  let parseError = null;

  if (contract.format === 'json' && trimmed.length > 0) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      parseError = err.message;
    }
  }

  return {
    raw,          // exactly what the agent returned
    trimmed,      // whitespace stripped
    parsed,       // the JSON object, or null if it did not parse
    parseError,   // why it did not parse
    steps: Array.isArray(agentOutput.intermediateSteps)
      ? agentOutput.intermediateSteps
      : [],
    contract,
  };
}

// =====================================================================
// STEP 2 — THE CHECKS
// Each check is an object with a name and a run() function.
// run() returns a string describing the problem, or null if fine.
// Adding a new check means adding to this array. Nothing else changes.
// =====================================================================

// Anchored on a first-person subject on purpose.
// A bare /cannot/i would flag "Cannot log in after password reset",
// which is a customer describing their problem, not a refusal.
const REFUSAL_PATTERNS = [
  /\bi'?m sorry\b/i,
  /\bi apologi[sz]e\b/i,
  /\bi (?:can ?not|can't|am unable to)\b/i,
  /\bi don'?t have access\b/i,
  /\bas an ai\b/i,
];

const CHECKS = [
  {
    name: 'isEmpty',
    run(ctx) {
      // .trim() first: "   \n  " is truthy in JavaScript, so a naive
      // `if (!output)` would let it through.
      if (ctx.trimmed.length === 0) {
        return 'Agent returned no content (empty or whitespace only).';
      }
      return null;
    },
  },

  {
    name: 'isRefusal',
    run(ctx) {
      const hit = REFUSAL_PATTERNS.find((p) => p.test(ctx.trimmed));
      if (hit) {
        return `Output reads as a refusal (matched ${hit}).`;
      }
      return null;
    },
  },

  {
    name: 'validJson',
    run(ctx) {
      // Only applies when the contract actually asked for JSON.
      if (ctx.contract.format !== 'json') return null;

      // Empty output is isEmpty's job. Stay quiet.
      if (ctx.trimmed.length === 0) return null;

      if (ctx.parseError !== null) {
        return `Expected JSON but parsing failed: ${ctx.parseError}`;
      }
      if (typeof ctx.parsed !== 'object' || ctx.parsed === null || Array.isArray(ctx.parsed)) {
        return 'Expected a JSON object at the top level.';
      }
      return null;
    },
  },

  {
    name: 'requiredKeys',
    run(ctx) {
      const required = ctx.contract.requiredKeys || [];
      if (required.length === 0) return null;

      // If it did not parse, that is validJson's failure to report.
      // Reporting "3 keys missing" on top would send the user chasing
      // the wrong problem. One root cause, one message.
      if (ctx.parsed === null || typeof ctx.parsed !== 'object') return null;

      const missing = required.filter((key) => !(key in ctx.parsed));
      if (missing.length > 0) {
        return `Missing required key(s): ${missing.join(', ')}`;
      }
      return null;
    },
  },
];

// =====================================================================
// STEP 3 — THE ENTRY POINT
// Build context, run every check, collect the failures.
// =====================================================================
function checkOutput(agentOutput, contract) {
  const ctx = buildContext(agentOutput, contract);
  const failures = [];

  for (const check of CHECKS) {
    const message = check.run(ctx);
    if (message !== null) {
      failures.push({ check: check.name, message });
    }
  }

  return { ok: failures.length === 0, failures };
}

module.exports = { checkOutput, buildContext, CHECKS };
