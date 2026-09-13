import type { Language } from "./types";

const en = {
  title: "Local usage", subtitle: "Browser messages accepted by ChatGPT on this device.",
  days7: "7 days", days30: "30 days", range: "Date range", refresh: "Refresh", total: "Accepted messages",
  today: "Today", week: "This week · Monday start", accepted: "Accepted", completed: "Completed", error: "Failed after acceptance",
  loading: "Reading local usage…", empty: "No local usage recorded yet", emptyBody: "New accepted browser messages will appear here. Earlier activity is not reconstructed.",
  unreadable: "Local usage could not be read", errorBody: "No totals are shown because the local record is unavailable. Try refreshing.",
  failed: "Could not load local usage", partial: "Some records were skipped. Totals may be incomplete.",
  daily: "Daily activity", details: "Daily details", date: "Date", tier: "Model / effort", lifetime: "Pro · all recorded activity",
  version: "Version", source: "Evidence", observed: "Observed", selfReported: "Self-reported", unknown: "Unknown", noPro: "No Pro messages recorded yet.",
  proUnknown: "Pro · version unknown", manualUnknown: "Zero Risk · unverified", since: "Recorded since", timezone: "Local timezone",
  boundary: "Local counts, not official remaining quota. Today and this week use the timezone shown; the week starts on Monday.",
  semantics: "Each accepted browser message counts once, including every multipart stage. A later failure does not remove it. Completed messages are shown separately. Tool calls, pre-send failures, and duplicate retries are excluded.",
  privacy: "Only local counts and model metadata are stored, never prompt text. Unverified versions are excluded from the two exact Pro cards.",
  none: "No messages",
};
type UsageCopy = typeof en;
const zh: UsageCopy = {
  title: "本地用量", subtitle: "此设备上已被 ChatGPT 接受的浏览器消息。",
  days7: "7 天", days30: "30 天", range: "日期范围", refresh: "刷新", total: "已接受消息",
  today: "今天", week: "本周 · 周一开始", accepted: "已接受", completed: "已完成", error: "接受后失败",
  loading: "正在读取本地用量…", empty: "尚无本地用量记录", emptyBody: "新接受的浏览器消息会显示在这里；不会补算此前的活动。",
  unreadable: "无法读取本地用量", errorBody: "本地记录不可用，因此未显示统计数字。请尝试刷新。",
  failed: "无法加载本地用量", partial: "部分记录已跳过，统计可能不完整。",
  daily: "每日活动", details: "每日明细", date: "日期", tier: "模型 / 推理档位", lifetime: "Pro · 全部已记录活动",
  version: "版本", source: "依据", observed: "已观测", selfReported: "手动确认", unknown: "未知", noPro: "尚无 Pro 消息记录。",
  proUnknown: "Pro · 版本未知", manualUnknown: "Zero Risk · 未验证", since: "开始记录于", timezone: "本地时区",
  boundary: "这是本地计数，不是官方剩余额度。今天和本周均按所示时区计算；每周从周一开始。",
  semantics: "每条被接受的浏览器消息计一次，包括多段消息的每一段。接受后失败仍计入，完成数单独显示。工具调用、发送前失败及重复重试不计入。",
  privacy: "仅保存本地计数和模型元数据，不保存提示词。未验证版本不计入两个精确 Pro 卡片。", none: "无消息",
};
const ja: UsageCopy = {
  title: "ローカル使用量", subtitle: "このデバイスで ChatGPT に受け付けられたブラウザメッセージ。",
  days7: "7 日間", days30: "30 日間", range: "期間", refresh: "更新", total: "受付済みメッセージ",
  today: "今日", week: "今週 · 月曜日から", accepted: "受付済み", completed: "完了", error: "受付後に失敗",
  loading: "ローカル使用量を読み込み中…", empty: "使用量はまだ記録されていません", emptyBody: "新しく受け付けられたブラウザメッセージが表示されます。過去の活動は復元されません。",
  unreadable: "ローカル使用量を読み取れません", errorBody: "ローカル記録を利用できないため、集計は表示していません。更新をお試しください。",
  failed: "ローカル使用量を読み込めませんでした", partial: "一部の記録をスキップしました。集計が不完全な可能性があります。",
  daily: "日別の活動", details: "日別の詳細", date: "日付", tier: "モデル / 推論レベル", lifetime: "Pro · 記録済みの全活動",
  version: "バージョン", source: "根拠", observed: "観測済み", selfReported: "自己申告", unknown: "不明", noPro: "Pro メッセージはまだ記録されていません。",
  proUnknown: "Pro · バージョン不明", manualUnknown: "Zero Risk · 未確認", since: "記録開始", timezone: "ローカルタイムゾーン",
  boundary: "ローカルの集計であり、公式の残り利用枠ではありません。今日と今週は表示されたタイムゾーンに従い、週は月曜日から始まります。",
  semantics: "複数パートの各段階を含め、受け付けられたブラウザメッセージを各 1 回計上します。受付後の失敗も含み、完了数は別に表示します。ツール呼び出し、送信前の失敗、重複した再試行は除外します。",
  privacy: "ローカル集計とモデル情報のみを保存し、プロンプト本文は保存しません。未確認バージョンは 2 つの Pro カードから除外します。", none: "メッセージなし",
};
export function usageCopyFor(language: Language): UsageCopy {
  return language === "zh-CN" ? zh : language === "ja" ? ja : en;
}
