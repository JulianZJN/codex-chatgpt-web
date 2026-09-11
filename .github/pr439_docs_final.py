from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one source block in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "README.md",
    """manual Zero Risk turns are unchanged. An unavailable or unverifiable version stops before sending
the pending prompt, with no fallback. GPT-6 uses **Latest** only while ChatGPT verifies it as 6 Pro.
""",
    """manual Zero Risk turns are unchanged. An unavailable or unverifiable version stops before sending
the pending prompt, with no fallback. GPT-6 accepts ChatGPT's **Latest** entry or an explicit
**GPT-6 / GPT-6 Astra** entry, but the live control must still verify 6 Pro before submission.
""",
)

replace_once(
    "README.zh-CN.md",
    """无需重启 Codex 或启动器，不影响其他档位及手动 Zero Risk 回合。所选版本不可用或无法验证时，
会在发送当前提示词前报错，不会切换到其他版本；GPT-6 仅在验证显示为 6 Pro 时使用“最新”选项。
""",
    """无需重启 Codex 或启动器，不影响其他档位及手动 Zero Risk 回合。所选版本不可用或无法验证时，
会在发送当前提示词前报错，不会切换到其他版本。GPT-6 可匹配 ChatGPT 的“最新”或明确的
**GPT-6 / GPT-6 Astra** 选项，但发送前实时控件仍必须验证为 6 Pro。
""",
)

replace_once(
    "README.ja.md",
    """送信前にエラーとなり、別のモデルへ切り替えません。GPT-6 は 6 Pro と確認できる場合のみ
**最新**を使用します。
""",
    """送信前にエラーとなり、別のモデルへ切り替えません。GPT-6 は ChatGPT の **最新**または明示的な
**GPT-6 / GPT-6 Astra** 項目に一致できますが、送信前にライブコントロールが 6 Pro と確認できる
ことが必須です。
""",
)

replace_once(
    "docs/pro-model-selection.md",
    """browser rechecks the selected version and effort. Missing or changed controls fail without sending
the pending prompt or silently selecting another model. Selecting **Latest** for GPT-6 is not enough:
the slider must identify version 6, so a future Latest version cannot silently satisfy that pin.
""",
    """browser rechecks the selected version and effort. Missing or changed controls fail without sending
the pending prompt or silently selecting another model. Selecting **Latest** or an explicit
**GPT-6 / GPT-6 Astra** option is not proof on its own: the slider must still identify version 6.
This prevents a future Latest version or a nearby label such as GPT-6 Mini from silently satisfying
the pin.
""",
)

replace_once(
    "docs/pro-model-selection.md",
    """`tests/pro-model-selection.test.ts` models that fixture at the browser locator boundary and
exercises the actual selection and pre-send methods. It covers every pinned version,
missing options, mismatched version labels, a future Latest version, multipart preparation, and a
picker reset before submission. Run it with:
""",
    """`tests/pro-model-selection.test.ts` models that fixture at the browser locator boundary and
exercises the actual selection and pre-send methods. It covers every pinned version,
missing options, mismatched and nearby model labels, a future Latest version, multipart preparation,
and a picker reset before submission. The regression suite also executes the real described-node
parser against reordered targets, rejects unrelated instructional text containing `Pro`, and checks
cleanup-error precedence at the final fail-closed send boundary. Run it with:
""",
)
