# agent-contract

**Deterministic output checks for AI agents in n8n.** No AI, no API key, no dependencies. One file you paste into a Code node.

![The Code node catching a phantom tool call in a live n8n workflow](docs/verified-in-n8n.png)

*n8n says the step succeeded. The output isn't usable. Both of those are true at the same time.*

---

## The problem

About a year ago I worked on an automation that pushed Google Form responses through Zapier into Slack, so the operations team knew what needed doing. For a while, nothing showed up in Slack. Zapier said every run completed. No error, no alert, no failed step — we only caught it because someone noticed the messages had stopped.

The automation didn't crash. It just quietly did nothing.

AI agents fail the same way, but more often and more convincingly. n8n marks a node successful if its code didn't throw an exception. For a normal node that's a fine test — a broken HTTP request throws, so "didn't crash" and "worked" mean the same thing. For an LLM node they stop meaning the same thing, because a model always returns text, and text is always a valid return value.

So when your agent returns `I'm sorry, I don't have access to that information`, the node goes green. When it invents a customer's plan tier instead of looking it up, the node goes green. That output flows downstream into your CRM, your email send, your webhook, and nothing in the run history suggests anything went wrong.

Worth being precise here: n8n's behaviour with tool failures isn't uniform. Some tool errors do fail the workflow, and there's an [open issue](https://github.com/n8n-io/n8n/issues/24042) about errors killing the run instead of being handed back to the agent. What I ran into was different, and it's the case below.

## I found this on my first test run

I gave an n8n AI Agent a Calculator tool and this prompt:

> Use the calculator tool to compute 8472913 * 23641. **Do not calculate it yourself.**

The agent ignored the tool, did the arithmetic internally, and returned:

```json
{ "question": "8472913 * 23641", "answer": 200308136233 }
```

The answer is correct. The node was green. `intermediateSteps` was absent entirely — no tool was called.

My first thought was that something was broken: a misconfiguration, a bug, the agent not reading its instructions. It wasn't. The agent behaved exactly as designed. Language models decide for themselves whether a tool is worth using, and this one decided it could do the maths. **The system working normally produced a result I couldn't trust.**

If this were a bug, someone would fix it. It isn't, so it needs a guard.

## What it checks

| Check | Catches |
|---|---|
| `isEmpty` | Nothing came back, or whitespace only |
| `isRefusal` | The model declined the task |
| `validJson` | Output won't parse when JSON was required |
| `requiredKeys` | Expected fields are missing |
| `phantomTool` | **Agent answered without calling its required tools** |
| `placeholderLeak` | Template scaffolding shipped as real content |
| `truncation` | Output cut off by the token ceiling |
| `promptEcho` | The agent handed your prompt back |
| `emptyCollection` | **A tool ran, succeeded, and returned zero rows** |

`phantomTool` also covers the case where the tool ran, returned an error, and the agent answered anyway — when that error doesn't stop the workflow.

## Install

There's nothing to install. Copy [`n8n-code-node.js`](n8n-code-node.js) into a **Code** node placed immediately after your AI Agent node, then edit the contract at the top:

```js
const contract = {
  format: 'json',
  requiredKeys: ['customer_name', 'priority'],
  mustCallTools: ['get_customer_record'],
  collectionTools: [],
  forbidPlaceholders: true,
};
```

Every item passing through gains two fields:

```json
{
  "contractOk": false,
  "contractFailures": [
    {
      "check": "phantomTool",
      "message": "Required tool(s) never called: get_customer_record."
    }
  ]
}
```

### Making the error workflow actually fire

By default this node stays green and you branch on `contractOk` with an IF node. That works, but it's a step people forget — and a checker that fails silently has the same problem it was built to catch.

Set `throwOnFail = true` at the top and the node throws instead. n8n marks the execution as failed, and your error workflow fires without any extra wiring.

Follow it with an IF node on `{{ $json.contractOk }}`. Route the false branch to a retry, a human review queue, or an alert — anything except silently dropping the item, which trades a visible bad record for an invisible missing one.

## What it does not do

**It cannot tell you most kinds of wrong answer.** `emptyCollection` covers one narrow slice — a tool that returned nothing when it should have returned something — but that only works if the tool reports a count. Everything else is out of scope.

**It cannot tell you whether the answer is correct.** Ask an agent `2 + 2` and it will pass both `4` and `5`. Both are well-formed. Checking correctness requires a model that understands the task, which is a different and much harder problem.

**It doesn't read the agent's prose.** `phantomTool` doesn't parse a sentence like "I checked the customer record" to detect the claim. It compares the contract's required tools against the actual tool-call log. That catches fabrication anyway — an agent that invented a lookup didn't perform one — without needing to interpret language.

**`promptEcho` needs the original input.** If your agent output doesn't include an `input` field, that check is a no-op.

## Why not just use an LLM to check the LLM?

Because then you have two things that can be confidently wrong instead of one.

A judge model costs money on every run, adds latency, and can hallucinate its own verdict. Worse, it fails *unpredictably* — the same input can pass on Tuesday and fail on Wednesday.

Every check here is plain string and JSON logic. It runs offline, in milliseconds, at zero cost, and gives the same verdict on the same input every time. The narrow scope is deliberate. I'd rather have something that's always right about a small question than something that's usually right about a big one, because the second kind gets switched off the first time it's wrong.

## False positives are the real enemy

If this misses a bad output, you get one bad record. If it flags a good one, someone deletes the node — and then it catches nothing at all.

So the patterns are kept narrow. Refusal detection needs a first-person subject, because a support ticket that says *"Cannot log in after password reset"* is a customer describing their problem, not a model refusing to help.

I found a real one while testing against live output. The `truncation` check flagged this as cut off:

```
847 * 236 = 847 * (200 + 30 + 6) = 169400 + 25410 + 5082 = 199892
```

Complete, correct, and ending in a digit. My rule assumed prose always ends in punctuation — but real agent output ends in numbers constantly: totals, IDs, dates, percentages. Every fixture I'd written by hand was a tidy English sentence, so nothing in my invented test set exposed it.

Real output caught it on the first run. The rule now accepts digits as a valid ending, and there's still a fixture covering actual truncation.

## Tests

```
npm test
```

Runs two suites. The first runs all nine checks against 14 fixtures — most written by hand, two captured from live n8n runs, and three covering the collection cases. The second executes the *generated* Code node in a simulated sandbox to confirm it behaves identically to the tested source, so the shipped file and the tested file can't silently drift apart.

```
npm run build
```

Regenerates `n8n-code-node.js` from `check.js`. The generated file is never edited by hand.

## Status

v0.3.0. Nine checks implemented and tested against 14 fixtures, two of them captured from live n8n runs. Verified end-to-end in a real workflow.

The `emptyCollection` check and the `throwOnFail` option came from feedback in the n8n community thread linked above.

Issues and PRs welcome. If you have real agent output that breaks one of these checks, that's the most useful thing you could send me.

## License

MIT
