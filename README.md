YouTube 視聴目的ユーザースクリプト — 日本語ガイド

There is English Guide below

動画の再生前に「なぜ観るのか？」の入力を求め、学習とそれ以外の視聴時間を自動集計。Shorts ブロックや任意の視聴上限で、集中を保つためのユーザースクリプトです。

	•	対応サイト: youtube.com / m.youtube.com（PC・モバイル）
	•	要件: 最新の Chromium / Firefox 系ブラウザ + ユーザースクリプトマネージャ（Tampermonkey / Violentmonkey / Userscripts 等）
	•	保存先: すべてのデータは ブラウザの localStorage のみ（外部送信なし）

⸻

主な機能
	•	再生前にカテゴリ＋理由入力を必須化（最小文字数は設定可能）
	•	入力内容に基づき 「学習」「娯楽」「その他」 の視聴時間を 日別で自動計測
	•	その日の合計視聴時間を常時表示する オーバーレイ と、履歴を一覧できる 集計パネル
	•	学習以外の視聴時間に 1 日上限 を設定し、超過時は再生ブロック
	•	YouTube Shorts の自動ブロック／リダイレクト、関連 UI の非表示
	•	ホーム画面のアイコン／ロゴを完全に隠し、https://www.youtube.com/ へアクセスした場合は常に /feed/subscriptions に自動リダイレクト
	•	検索バーにフォーカスすると「学習／娯楽／情報収集」モードの選択を強制
	•	娯楽モードでは 5/10/15 分タイマー＋終了後の検索禁止モードを自動適用
	•	モードインジケーターで現在のモードや残り時間を常時表示
	•	情報収集モードでは「何を知りたいか」「何のためか」を入力し、所要時間タイマーと完了確認モーダルで振り返りを促す（Notion での整理をリマインド）
	•	ホーム画面で「今日の目的」を毎日入力させ、入力済みテキストを中央に常時表示（編集ボタンからいつでも更新可能）
	•	娯楽モードはバッジの「中断」ボタンで終了でき、中断後はホーム画面へ遷移
	•	PC / モバイル版（m.youtube.com）どちらでも動作

⸻

動作要件
	•	最新の Chromium / Firefox 系ブラウザ
	•	ユーザースクリプトマネージャ（Tampermonkey, Violentmonkey, Userscripts など）

⸻

インストール
	1.	ユーザースクリプトマネージャで 新規スクリプト を作成します。
	2.	youtube_reason.user.js の内容を コピーして貼り付け、保存 します。
	3.	スクリプトを 有効化 した状態で YouTube を開き、動作を確認します。

⸻

使い方
	1.	YouTube で動画を開くと 再生前にモーダル が表示されます。
	2.	カテゴリ（学習／作業／娯楽／その他）と 視聴理由 を入力すると再生が許可されます。
	3.	同じ動画へ戻った場合は 前回の入力が自動承認 され、すぐ再生できます。
	4.	画面右上に 当日の視聴時間オーバーレイ が表示されます。 「集計」 ボタンから日別サマリーと直近の理由履歴を確認できます。
	5.	Shorts にアクセスすると、設定に応じて ブロック／リダイレクト されます。

⸻

設定（CONFIG）

スクリプト冒頭の CONFIG オブジェクトを編集して挙動を調整できます。

設定キー	説明	既定値
ENABLE_NON_LEARNING_LIMIT	学習以外カテゴリの 1 日視聴時間に上限を設けるかどうか	false
NON_LEARNING_LIMIT_MIN	学習以外カテゴリの視聴時間上限（分）	30
ENABLE_ENTERTAINMENT_LIMIT	娯楽カテゴリの 1 日視聴時間に上限を設けるかどうか	false
ENTERTAINMENT_LIMIT_MIN	娯楽カテゴリの視聴時間上限（分）	30
MIN_REASON_LEN	理由入力の最小文字数	5
MODAL_WIDTH	理由入力モーダルの最大幅（px）	520
BLOCK_SHORTS	Shorts 動画への遷移をブロックする	true
HIDE_SHORTS_UI	Shorts 関連のサムネイルやリンクを非表示にする	true
SHORTS_REDIRECT_URL	Shorts アクセス時のリダイレクト先（空文字でモーダル表示）	“/feed/subscriptions”
SHOW_WATCH_OVERLAY	右上の視聴時間オーバーレイを表示する	true
ENABLE_SUMMARY_PANEL	集計パネル（履歴テーブル）を有効にする	true

設定変更後はスクリプトを保存し、YouTube を再読み込みすると反映されます。

⸻

保存されるデータ

すべてのデータはブラウザの localStorage に保存され、外部へ送信されません。

保存キー	内容
yt_reason_store_v1	動画ごとの入力理由とカテゴリ、記録時刻、URL
yt_reason_daily_v1	日別の視聴時間（合計／学習／娯楽／その他）
yt_reason_approved_v1	再入力を省略してよい動画の承認フラグ
fg_mode_on_search_v1	検索モード選択・娯楽タイマー・検索禁止の状態を保持
fg_daily_purpose_v1	ホーム画面で入力した当日の目的テキスト

リセット したい場合は、ブラウザの開発者ツールで以下を実行するか、該当ドメインのローカルストレージを削除してください。

localStorage.removeItem('yt_reason_store_v1');
localStorage.removeItem('yt_reason_daily_v1');
localStorage.removeItem('yt_reason_approved_v1');
localStorage.removeItem('fg_mode_on_search_v1');
localStorage.removeItem('fg_daily_purpose_v1');


⸻

背景と動機

私はかつて、頭の中ではやりたいことや目標を描いていながら、いざ行動に移すことができない人間でした。その最大の原因は、私にとっての YouTube でした。多くの人にとっては「たかが YouTube」かもしれませんが、私の場合は違いました。夏休みなど最悪の日には、1日20時間近くを視聴してしまうこともあったのです。YouTube は私にとって「時間を奪う存在」でした。

もちろん、YouTube をプログラミング学習や大学の数学・情報学の勉強に活用していたのも事実です。しかし、そのことを言い訳にしてやめられなかったのです。自制心が強い人は勉強用途だけに使えるのでしょうが、私は誘惑に弱く、テスト期間でも「しなければいけないこと」を後回しにして、自分の興味のある動画だけを見続けてしまっていました。結果、何の価値も生まないコンテンツに膨大な時間を費やし、その日の終わりには強い虚無感だけが残りました。

なぜこのようになってしまうのかを考えた結果、私はまず「YouTube に何を求めているのか」を整理しました。本来は学習教材として使いたかったはずなのに、長時間視聴で疲れ、休憩の名目で好きなコンテンツへと移行し、そこからは学習に戻れないパターンを繰り返していたのです。しかも YouTube のレコメンド機能によって「無限報酬ループ」に入ってしまうことで、脳死状態のまま動画を見続ける習慣が固定化していました。

そこで私は、自分自身の行動を変える仕組みをつくることにしました。動画を再生するとき、脳死状態になる前に「この動画から何を得たいのか」を考えさせるため、再生前にカテゴリと視聴理由の入力を必須化するユーザースクリプトを導入しました。こうすることで「なぜこの動画を見るのか」を毎回自問自答できるようになったのです。さらに ADGUARD という拡張機能でレコメンド機能もブロックしました。

この2つの仕組みは、脳死で動画を再生していた私にとってまさに効果抜群でした。今では視聴時間を大幅に減らし、YouTube を本来の目的である学習に活用できるようになっています。

⸻

実績（導入後の効果）

導入日: 2025/09/22 — 週次・日次の実測値で改善を確認

週次サマリー
	•	9/14〜9/21（導入前）: 合計 40時間45分
	•	9/21〜9/27（導入直後）: 合計 20時間32分（前週比 約▲50%）
	•	9/27〜10/04（定着期）: 合計 14時間59分（さらに削減）



考察:
	•	導入前週から直後の週にかけて 視聴時間を約半減。翌週も 約27% の追加削減。
	•	10/01 以降は 視聴の 100% が「学習」目的 に統一。娯楽/その他の視聴を ほぼゼロ へ。
	•	「再生前の理由入力」と「学習以外の上限ガード」の併用が、“観る前に考える” 習慣化 と 時間の質の向上 に寄与。


⸻

トラブルシューティング
	•	モーダルが出ない / カウントされない: スクリプト有効化を確認し、YouTube を ハードリロード。他の YouTube 系拡張を一時無効化して競合を確認。
	•	Shorts がブロックされない: BLOCK_SHORTS: true と HIDE_SHORTS_UI: true を確認。アクセス先が youtube.com/shorts/ か確認。
	•	集計がおかしい: 上記の保存キーを削除して 初期化。


⸻

更新履歴
	•	2025/10/15
		◦	検索バーでモード選択を必須化し、娯楽モードに視聴タイマーと検索禁止モードを追加
		◦	娯楽モード中の強制ホーム遷移ガードを廃止し、通常のナビゲーションを維持
		◦	ホーム画面で「今日の目的」を強制入力させ、入力済みテキストを中央表示＆編集ボタンで更新可能に
		◦	娯楽モードの残り時間バッジに中断ボタンを追加し、中断後はホームへ自動遷移
		◦	情報収集モードに目的入力・タイマー・完了確認モーダル・Notion メモ促しを追加し、モードインジケーターで状況を可視化
	•	2025/11/15
		◦	検索モードモーダルの選択肢から「情報収集」を削除し、学習か娯楽のいずれかに集中できるよう仕様を簡素化
		◦	娯楽モードの残り時間バッジから「中断」ボタンを撤去し、設定した時間までは観続けず待つ運用に統一
		◦	iPad 向けスクリプト（youtube_reason.forIpad.js）を追加し、検索バーを全面非表示 & Subscriptions タブの表示動画/チャンネルを最新3件だけに制限
	•	2025/11/19
		◦	iPad 版でホームアイコン／ロゴを完全に隠し、ホームへのリンクをすべて無効化
		◦	https://www.youtube.com/ へアクセスした際は常に /feed/subscriptions へリダイレクトする強制遷移を追加

⸻

既知の制限
	•	オフライン再生や他の拡張機能が動画の再生を制御している場合、カウントが正しく行われない可能性があります。
	•	YouTube 側の大幅な UI 変更が入った場合、モーダルや UI の挙動に影響が出ることがあります。

⸻

ライセンス

スクリプトと同じライセンスを参照してください（必要に応じて追記）。

⸻

YouTube Purpose-Aware Userscript — English Guide

A userscript designed to encourage purposeful viewing on YouTube. Before playing a video, it requires you to enter a reason, and it automatically tracks daily watch time divided into learning and non-learning categories. It also includes options such as blocking Shorts and setting custom time limits to maintain focus.

	•	Supported Sites: youtube.com / m.youtube.com (PC & Mobile)
	•	Requirements: Latest Chromium / Firefox browser + Userscript manager (Tampermonkey / Violentmonkey / Userscripts)
	•	Data Storage: All data is stored locally in the browser’s localStorage (no external transmission)

⸻

Key Features
	•	Mandatory category + reason input before playback (minimum character length configurable)
	•	Automatically tracks watch time by category (Learning / Entertainment / Other) on a daily basis
	•	Overlay showing daily total watch time and a summary panel listing history and reasons
	•	Ability to set a daily time cap for non-learning categories, blocking playback once exceeded
	•	Block/redirect YouTube Shorts and hide related UI elements
	•	Completely hide the Home icons/logos and force any visit to https://www.youtube.com/ to redirect to /feed/subscriptions
	•	Force-select a viewing mode (Learning / Leisure / Research) whenever the search bar is focused
	•	Start a 5/10/15 minute leisure timer and trigger a search-ban cooldown once the timer ends
	•	Show a persistent mode indicator with the active mode and remaining timers
	•	For Research mode, capture “what to learn” and “why,” run a focused timer, then ask if the task was accomplished and remind you to summarise in Notion
	•	On the home feed, require a daily purpose entry, keep the saved text centered, and provide an edit button
	•	Allow cancelling leisure mode from its badge, automatically returning to the home feed
	•	Works on both PC and mobile (m.youtube.com)

⸻

Requirements
	•	Latest Chromium / Firefox browser
	•	Userscript manager (Tampermonkey, Violentmonkey, Userscripts, etc.)

⸻

Installation
	1.	Open your userscript manager and create a new script.
	2.	Copy and paste the contents of youtube_reason.user.js into the editor, then save.
	3.	Enable the script, open YouTube, and confirm it works.

⸻

Usage
	1.	When opening a YouTube video, a modal appears before playback.
	2.	Select a category (Learning / Work / Entertainment / Other) and enter a reason to continue.
	3.	Returning to the same video will auto-approve the previous input and play immediately.
	4.	A watch time overlay appears at the top-right showing the day’s total. Use the “Summary” button to view daily totals and recent reason history.
	5.	When accessing Shorts, the script will block or redirect depending on configuration.

⸻

Configuration (CONFIG)

Adjust behavior by editing the CONFIG object at the top of the script.

Key	Description	Default
ENABLE_NON_LEARNING_LIMIT	Enable daily time cap for non-learning categories	false
NON_LEARNING_LIMIT_MIN	Daily cap for non-learning categories (minutes)	30
ENABLE_ENTERTAINMENT_LIMIT	Enable daily time cap for the entertainment category	false
ENTERTAINMENT_LIMIT_MIN	Daily cap for the entertainment category (minutes)	30
MIN_REASON_LEN	Minimum character length for input reasons	5
MODAL_WIDTH	Maximum width (px) of the input modal	520
BLOCK_SHORTS	Block navigation to Shorts	true
HIDE_SHORTS_UI	Hide Shorts-related thumbnails and links	true
SHORTS_REDIRECT_URL	Redirect URL when accessing Shorts (empty = show modal)	“/feed/subscriptions”
SHOW_WATCH_OVERLAY	Show watch time overlay in the top-right corner	true
ENABLE_SUMMARY_PANEL	Enable summary panel (history table)	true

After editing, save the script and reload YouTube to apply changes.

⸻

Stored Data

All data is stored in localStorage within the browser. Nothing is sent externally.

Key	Content
yt_reason_store_v1	Reason + category per video, timestamp, URL
yt_reason_daily_v1	Daily watch time (total / learning / others)
yt_reason_approved_v1	Approval flag to skip re-entering for videos
fg_mode_on_search_v1	Mode-selection state, leisure timer, and search-ban cooldown
fg_daily_purpose_v1	Daily purpose text captured on the home feed

Resetting: Use developer tools to clear specific keys or remove YouTube’s localStorage entirely.

localStorage.removeItem('yt_reason_store_v1');
localStorage.removeItem('yt_reason_daily_v1');
localStorage.removeItem('yt_reason_approved_v1');
localStorage.removeItem('fg_mode_on_search_v1');
localStorage.removeItem('fg_daily_purpose_v1');


⸻

Changelog
	•	2025/10/15
		◦	Enforced mode selection on search focus with leisure timers and search-ban cooldown
		◦	Removed the forced redirection to home when leisure-mode videos end or leave `/watch`
		◦	Required a daily purpose entry on the home feed, centered it, and added an edit button for updates
		◦	Added a cancel button to the leisure timer badge that stops the session and returns to home
		◦	Expanded Research mode with goal capture, focused timers, completion check modal, and Notion follow-up prompt, plus a persistent mode indicator

⸻

Background & Motivation

I used to be someone who always had goals and ambitions in my head, but struggled to take real action. The biggest reason for this was YouTube. For many people, it might seem trivial—“just YouTube”—but in my case it was different. At its worst, during summer vacation, I watched videos for nearly 20 hours a day. YouTube became something that stole my time.

Yes, I often used YouTube for programming tutorials and university-level math and computer science content. But that became an excuse not to quit. Strong-willed people can use it only for study, but I was weak against temptation. Even during exam periods, I procrastinated and ended up watching only the things I found interesting. As a result, I wasted countless hours on meaningless content, ending each day with nothing but emptiness.

When I reflected on this, I realized that what I truly wanted from YouTube was learning material. However, after long study sessions, I would reward myself with entertainment videos, and once I switched, I almost never returned to studying that day. Worse, the recommendation system trapped me in an infinite loop of rewards—watching video after video in a brain-dead state.

To break this pattern, I built a system for myself. Before starting playback, the script forces me to specify the category and reason for watching. This small pause ensures I consciously ask myself “Why am I watching this video?” before I lose awareness. On top of that, I blocked recommendations entirely using ADGUARD.

This combination has been extremely effective. For someone like me, who once played videos mindlessly, these measures were transformative. Now, my watch time has dropped significantly, and I use YouTube only for its original purpose—learning.

⸻

Results (Post-Implementation)

Introduced on: 2025/09/22 — Improvements verified with weekly and daily logs

Weekly Summary
	•	9/14–9/21 (before): Total 40h45m
	•	9/21–9/27 (first week): Total 20h32m (≈50% reduction)
	•	9/27–10/04 (stabilized): Total 14h59m (further reduction)

Insights
	•	Watch time was cut in half the week after introduction, and reduced
