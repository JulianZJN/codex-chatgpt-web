# Local usage statistics

The launcher settings show messages sent through this local Web GPT installation, not an official account allowance or remaining-quota counter. Activity in another browser, on a phone, or on another computer is not included.

## What counts

- Automatic mode records a message only after the existing browser submission checks establish that ChatGPT accepted it. A failure before acceptance does not count.
- Accepted messages remain counted if generation subsequently fails or is cancelled. Completion and error outcomes are tracked separately from accepted sends.
- A multipart prompt contributes one count for each accepted part. The chart counts browser messages, not outer Codex tasks, tokens, or tool calls.
- Repeated callbacks for the same message do not add another count. Ordinary tool exchanges within the accepted response do not add messages.
- Pro versions use the observed model identity. An unknown version is displayed as unknown, never silently attributed to GPT-6 or GPT-5.6.
- Zero Risk mode does not start inspecting ChatGPT for statistics. Its user-confirmed activity is marked separately; an unspecified model is not assigned an exact Pro version.

## Settings view

The 7-day and 30-day stacked charts show daily activity by tier. Pro versions have separate series. The summary highlights GPT-5.6 Pro for today and GPT-6 Pro for this week, and a dedicated Pro table shows cumulative activity by version.

Days use the local time zone displayed in the view. Weeks start on Monday. These are calendar reporting windows, not claims about OpenAI's rolling limits or official reset schedule.

Daily records keep the calendar date recorded at acceptance. Moving between time zones does not rewrite old days; the view warns when history includes another time zone. Completion is attributed to the message's acceptance day, even across midnight.

Collection starts when this feature is first used; it does not reconstruct previous messages from private chat history. A new installation has an empty view. An unreadable or corrupt statistics file shows an error instead of presenting an authoritative zero.

## Privacy and reliability

Statistics stay in the configured local core home and are not uploaded. They contain counts, timestamps, model/tier labels and local deduplication metadata, not prompts, responses, credentials, cookies, tunnel identifiers or conversation content.

Statistics collection must not change model selection, send a probe request, alter the tool protocol, or turn a successful model response into a failure when recording is unavailable. Local activity is only an aid for understanding usage; it cannot establish your account's exact remaining allowance.

Daily aggregates retain up to 400 recorded dates; Pro lifetime totals are kept separately. Deduplication metadata is bounded, with pending receipts retained for up to seven days. A crashed process or a late outcome beyond that retention can leave an accepted message without a completed/error outcome; it must not count as another send. Storage failures are logged and can make these local totals incomplete.

For a synthetic UI preview without accessing an account, run `bun x --no-install vite --host 127.0.0.1` from `launcher/`, then open `/tests/usage-ui.fixture.html` on the displayed local URL. Its fixture toolbar exercises languages and loading/empty/error states without calling launcher IPC or ChatGPT.
