# Local usage statistics

The launcher's Statistics page counts messages sent through this local Web GPT installation. It is not an account allowance or remaining-quota counter. Activity in another browser, on a phone, or on another computer is not included. Counters belong to the core home, not a ChatGPT account: switching accounts does not separate or reset them.

## What counts

Automatic mode records a message after the existing browser submission checks establish that ChatGPT accepted it. A failure before acceptance does not count. Each accepted multipart stage counts separately; ordinary tool exchanges do not add messages.

Accepted messages remain counted if generation later fails or is cancelled. Completion and failure are separate outcomes. Duplicate callbacks do not add another count, but a newly accepted resend does. If writing a terminal outcome fails, a later callback retries that original outcome and timestamp rather than changing a completed generation into a failure.

Pro versions come from observed model identity. Missing or ambiguous metadata stays unknown. Zero Risk mode does not inspect ChatGPT for statistics: its user-confirmed activity is marked separately and is not assigned an exact Pro version.

## Reading the page

The 7-day and 30-day charts show activity by tier, with separate Pro-version series. The cards show GPT-5.6 Pro for today and GPT-6 Pro for this calendar week. The Pro table shows cumulative activity by version, including versions with no recorded messages.

The chart legend includes tiers used in the selected range. Tab enters the chart once, at the latest day; arrow keys, Home and End move between days. Enter or Space opens the day's details, and Escape dismisses them without moving focus. The daily table provides the same counts without relying on color or hovering.

The page refreshes every 30 seconds while visible and when the window regains focus. Quiet refreshes keep the current view until the read finishes. A failed read removes the totals rather than leaving stale values presented as current. Switching ranges discards responses for the old range.

“No outcome” is the difference between accepted messages and recorded completions/failures. It does not necessarily mean “running”: a process crash, expired receipt or failed write can leave the result unknown.

Days use the local timezone displayed in the view, and weeks start on Monday. These are calendar reporting windows, not OpenAI's rolling limits or official reset schedule. Daily records keep the date recorded at acceptance; moving between timezones does not rewrite old days. Completion belongs to the acceptance day, even across midnight.

Collection starts when this feature is used. There is no scraping or reconstruction of earlier chat history. A new installation has an empty view. An unreadable store is not displayed as zero usage.

## Updates and backups

The store lives at `<core home>/usage/local-usage.json`. By default, the core home is `~/.codex-chatgpt-web`; `CODEX_CHATGPT_WEB_HOME` overrides it. The DEV profile uses a separate home. App updates and runtime replacement use the `versions/` directory, not `usage/`, so updating or reinstalling the application while keeping the same core home retains the records. Changing homes, changing operating-system users, or deleting that directory is not an automatic migration.

Before replacing an existing valid store, the writer saves its exact previous contents to `local-usage.json.bak`. Both files use the existing atomic-write helper and private permissions. A duplicate callback does not rotate the backup. If the backup cannot be written, the primary is left unchanged; statistics failure still does not fail the model turn.

The backup includes daily totals, Pro lifetime rows and deduplication receipts. It is one previous snapshot, not an archive or a guarantee against disk failure. Daily aggregates retain at most 400 recorded dates, while Pro lifetime totals are retained separately. The backup follows the same retention policy; it does not preserve every old daily record indefinitely.

The storage schema remains version 1 and is independent of the application version. Existing v1 files without `receiptHorizon` remain readable. Corrupt, oversized, or newer-schema stores are not overwritten or replaced with an empty store. Future format changes must include an explicit migration and preserve the old file before writing. A downgraded launcher that cannot read a newer format should be upgraded again, not used to reset the file.

### Recovering a damaged store

Stop the launcher and all core processes first. Save copies of both `local-usage.json` and `local-usage.json.bak` outside the usage directory before changing either file. If the primary is damaged and the backup is valid, copy the backup to `local-usage.json`, then reopen the launcher and check Statistics. Do not concatenate or sum snapshots: they overlap and doing so would double-count activity. The backup may omit the latest sends or outcomes.

A missing primary with an existing backup is treated as a recovery case, not a new installation. There is no silent rollback: automatically choosing an older snapshot could erase newer activity or replay receipts.

The writer uses `local-usage.json.lock`. An old lock is removed automatically only when its recorded process has exited. A live or unverifiable owner is not displaced just because the file is old. If a crash leaves a malformed legacy lock or a `.lock.reap` recovery guard, remove those lock files only after confirming that every launcher/core process using that home is stopped. Do not remove the JSON files to clear a lock.

## Privacy and reliability

Statistics stay in the local core home and are not uploaded. The files contain counts, timestamps, model/tier labels and random local deduplication identifiers, not prompts, responses, credentials, cookies, tunnel identifiers or conversation content. Back up the two usage files rather than exporting the entire core home, which contains unrelated application state.

Collection does not change model selection, send probe requests, inspect Zero Risk conversations or alter the tool protocol. Deduplication metadata is capped at 8,192 receipts. Unfinished receipts become eligible for pruning after seven days, when new activity is written. A late result beyond retention can remain unknown; it must not become another accepted message. Readers reject stores larger than 8 MiB rather than parsing unbounded input. Storage failures are logged and can make totals incomplete.

For a synthetic preview without an account, run `bun x --no-install vite --host 127.0.0.1` from `launcher/`, then open `/tests/usage-ui.fixture.html` on the displayed local URL. The fixture toolbar exercises languages and loading, empty and error states without calling launcher IPC or ChatGPT.

For refresh lifecycle checks in real React Strict Mode, open `/tests/usage-ui.refresh.fixture.html` on the same server. Resolve the latest initial request, then use the focus and range controls to create overlapping reads. Request IDs appear in the GPT-5.6 Pro today card: resolving an older request must not replace the current range. The fixture also supports rejected reads and unmounting; its IPC responses are synthetic and it never accesses an account.
