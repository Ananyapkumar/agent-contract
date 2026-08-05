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
    input: typeof agentOutput.input === 'string' ? agentOutput.input.trim() : '',
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

// Placeholder patterns require bracket context or ALL-CAPS on purpose.
// A customer can legitimately write "my todo list"; nobody legitimately
// writes "[insert name]" in a support ticket.
const PLACEHOLDER_PATTERNS = [
  /\[\s*(insert|your|enter|add|name|company|placeholder|xxx)/i,
  /\{\{\s*\w+\s*\}\}/,          // unrendered template variable
  /\b(lorem ipsum)\b/i,
  /\b(your_name_here|placeholder_text|fill_me_in)\b/i,
  /\bTODO\b/,                    // case-sensitive: "todo" in prose is fine
];

const TRUNCATION_MIN_LENGTH = 40;
const ECHO_THRESHOLD = 0.8;

// Pull out the human-readable strings worth inspecting. For a JSON
// contract that is the string values inside the object; otherwise it is
// the raw text itself.
function textValues(ctx) {
  if (ctx.parsed !== null && typeof ctx.parsed === 'object') {
    return Object.values(ctx.parsed).filter((v) => typeof v === 'string');
  }
  return ctx.trimmed.length > 0 ? [ctx.trimmed] : [];
}

// A digit is a legitimate ending. Real output finishes on numbers
// constantly: calculations, invoice totals, IDs, dates, percentages.
// Requiring terminal punctuation flagged "= 199892" as truncated,
// which is a false positive found against live n8n output.
// Truncation looks like stopping mid-word or mid-clause, so we treat
// a trailing letter as the signal instead.
function endsCleanly(text) {
  return /[.!?:;"')\]}0-9%]\s*$/.test(text);
}

// Jaccard similarity on lowercased word sets. Crude, deterministic, and
// entirely sufficient for "did it hand me my own prompt back".
function similarity(a, b) {
  const words = (s) =>
    new Set(s.toLowerCase().match(/[a-z0-9']+/g) || []);
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

// How many rows did a tool return? Returns null when the tool did not
// say — we cannot count rows inside an opaque string, so the caller
// stays quiet rather than guessing.
//
// Reads the { status, count, data } shape recommended by the n8n
// community thread. A bare success flag is not enough here: a tool that
// succeeded and returned nothing looks identical to one that succeeded
// and returned ten rows unless it reports the count.
function observedCount(observation) {
  let obj = observation;

  if (typeof observation === 'string') {
    try {
      obj = JSON.parse(observation);
    } catch (e) {
      return null; // opaque string, nothing to count
    }
  }

  if (obj === null || typeof obj !== 'object') return null;

  if (typeof obj.count === 'number') return obj.count;
  if (Array.isArray(obj.data)) return obj.data.length;
  if (Array.isArray(obj.results)) return obj.results.length;
  if (Array.isArray(obj.rows)) return obj.rows.length;
  if (Array.isArray(obj)) return obj.length;

  // status: 'empty' is an explicit declaration of zero.
  if (obj.status === 'empty') return 0;

  return null;
}

// Anchored at the START of the observation on purpose. A customer
// record might legitimately contain the word "error" somewhere in a
// support ticket body; a tool failure announces itself up front.
function looksLikeError(observation) {
  if (typeof observation !== 'string') return false;
  if (observation.trim().length === 0) return true;
  return /^\s*(error|exception|failed|traceback)\b/i.test(observation);
}

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

  {
    name: 'phantomTool',
    run(ctx) {
      const required = ctx.contract.mustCallTools || [];
      if (required.length === 0) return null;

      // Which tools did the agent ACTUALLY invoke?
      const called = ctx.steps
        .map((s) => s && s.action && s.action.tool)
        .filter(Boolean);

      // Case 1: the tool was never invoked at all.
      // The agent produced an answer without the data it needed,
      // which means it invented it.
      const never = required.filter((tool) => !called.includes(tool));
      if (never.length > 0) {
        return `Required tool(s) never called: ${never.join(', ')}. `
             + `The agent produced output without the data it claims to have used.`;
      }

      // Case 2: the tool WAS invoked but returned an error, and the
      // agent carried on regardless. n8n does not fail the execution
      // for this, so it is invisible in the run history.
      const errored = ctx.steps
        .filter(
          (s) =>
            s && s.action &&
            required.includes(s.action.tool) &&
            looksLikeError(s.observation)
        )
        .map((s) => s.action.tool);

      if (errored.length > 0) {
        return `Required tool(s) returned an error but the agent answered anyway: `
             + `${errored.join(', ')}.`;
      }

      return null;
    },
  },

  {
    name: 'emptyCollection',
    run(ctx) {
      // Only applies to tools the contract DECLARES as returning a
      // collection. A generic "output was empty" rule would fire on
      // every lookup that legitimately found nothing.
      const declared = ctx.contract.collectionTools || [];
      if (declared.length === 0) return null;

      const empty = [];

      for (const step of ctx.steps) {
        if (!step || !step.action) continue;
        if (!declared.includes(step.action.tool)) continue;

        // null means the tool did not report a count. We cannot infer
        // one from an opaque string, so we stay quiet rather than guess.
        if (observedCount(step.observation) === 0) empty.push(step.action.tool);
      }

      if (empty.length > 0) {
        return `Tool(s) returned zero rows but the agent answered anyway: `
             + `${empty.join(', ')}. Zero can be legitimate — watch the rate `
             + `rather than treating every occurrence as fatal.`;
      }
      return null;
    },
  },

  {
    name: 'placeholderLeak',
    run(ctx) {
      if (ctx.contract.forbidPlaceholders === false) return null;
      const hit = PLACEHOLDER_PATTERNS.find((p) => p.test(ctx.trimmed));
      if (hit) {
        return `Template placeholder left in output (matched ${hit}). `
             + `The agent shipped scaffolding instead of real content.`;
      }
      return null;
    },
  },

  {
    name: 'truncation',
    run(ctx) {
      // Truncated JSON does not parse, so validJson already owns that case.
      if (ctx.parseError !== null) return null;

      const cut = textValues(ctx).filter(
        (s) => s.length > TRUNCATION_MIN_LENGTH && !endsCleanly(s)
      );
      if (cut.length > 0) {
        return `Output appears cut off mid-sentence: "...${cut[0].slice(-45)}"`;
      }
      return null;
    },
  },

  {
    name: 'promptEcho',
    run(ctx) {
      // No-op unless the caller supplied the original input.
      if (!ctx.input || ctx.input.length < 20) return null;

      for (const value of textValues(ctx)) {
        if (value.length < 20) continue;
        if (similarity(ctx.input, value) >= ECHO_THRESHOLD) {
          return `Output substantially repeats the input rather than answering it `
               + `(${Math.round(similarity(ctx.input, value) * 100)}% word overlap).`;
        }
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
