# agent-contract

Deterministic output checks for AI agents in n8n.

An n8n AI Agent node turns green when the node did not throw an exception.
That says nothing about whether the output is usable.

Status: **v0.1 in progress.** Fixtures defined, checks not yet written.

## Why not use an LLM to check the LLM?

Then you have two things that can silently fail instead of one.
Every check here is plain string and JSON logic: free, instant, and
the same input always produces the same verdict.

MIT
