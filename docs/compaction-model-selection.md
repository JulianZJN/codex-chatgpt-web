# Optional model for Pro compaction

**Settings → Pro compaction model** controls the summary step of an automatic
ChatGPT Web Pro task. It does not change the model used for ordinary task turns.

| Choice | Summary execution |
| --- | --- |
| Follow main task (default) | Existing compaction behavior, with no override |
| GPT-5.6 Extra High | Explicit GPT-5.6 family at Extra High effort, not Pro |
| GPT-5.6 Pro | Explicit GPT-5.6 family at Pro effort |
| GPT-5.5 Pro | Explicit GPT-5.5 family at Pro effort |

The setting is sampled when a new compaction starts. Saving a different choice
does not interrupt an active turn or compaction, restart the service, or change
Codex's model catalogue. Choosing the default removes the optional preference.
Zero Risk, Luna, non-Pro tasks, and accounts without the required capabilities
keep their existing behavior.

## Why choose a different summary model?

Extra High avoids a Pro submission for the summary. Choosing an older Pro family
still uses that family's Pro allowance; it is an alternative for users who want
Pro for the checkpoint without selecting the same family as their main task.
Availability, shared allowances and reset schedules depend on the account and
ChatGPT's current rules. This is explicit model selection, not a quota bypass.
See the [official model and usage-limit documentation](https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt).

Reducing summary latency and avoiding some Pro-specific failure modes are goals,
not guaranteed outcomes. Changing the summary model can change checkpoint
quality. It does not repair browser disconnects, authentication failures, invalid
handoffs, or an unavailable model.

## Execution boundaries

1. Codex decides when to compact and sends its canonical history and native turn
   identity to the bridge. This setting does not change context thresholds.
2. The original request still identifies the retained source, shared compaction
   transaction, cancellation and retirement. Only the summary execution gets the
   selected model/effort override.
3. The existing retained-source handoff is preserved. An automatic task without
   a usable retained source uses the existing read-only fresh-chat fallback.
   Browser-only summaries use the same execution preference. Summary generation
   does not gain ordinary Codex work tools.
4. For an explicit override, multipart staging is restricted to non-Pro levels.
   An indivisible record that requires Pro's larger message envelope fails before
   sending; the bridge does not silently spend a Pro request on staging.
5. Before submission, the live model controls must prove the requested effort
   and family. A missing family, changed
   control or unavailable effort causes an explicit error, not a fallback.
6. The existing checkpoint validation and browser-release checks still run.
   Codex receives its replacement context and subsequent work uses the main
   task's original model.

The five-minute structured handoff liveness budget is unchanged. Existing
multipart progress acknowledgements can renew the relevant phase budget; this
is not a new fifty-minute timeout or an automatic retry of an accepted prompt.

## Configuration and compatibility

The optional core configuration field is `compactionModel`, with values
`extra-high`, `5.6-pro`, or `5.5-pro`. An omitted field means follow-main.
Use the launcher setting to persist it through the authenticated configuration
command. The override is not part of the retained source's execution namespace.

Both runtime and browser helper must support the `compaction-execution` feature.
An older helper cannot silently ignore an explicit choice. Unknown settings and
inconsistent execution payloads are rejected.

The production service reads this preference for each new eligible compaction.
The isolated DEV named-chat CLI snapshots its configuration at startup: reopen
that CLI after changing the DEV preference. The launcher itself need not restart.
