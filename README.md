# YouTube: 再生前に「なぜ見るのか」入力
The English version/explanation is shown below.

## 日本語ガイド
YouTube の視聴前に目的意識を促すためのユーザースクリプトです。動画の再生前に理由入力を求め、学習とそれ以外の視聴時間を自動で集計します。ショート動画のブロックや、任意の視聴時間制限など集中のためのオプションも備えています。

### 主な機能
- 再生前にカテゴリと視聴理由の入力を必須化（最小文字数は設定可能）
- 入力内容を基に「学習」「娯楽」「その他」の視聴時間を日別で自動計測
- その日の合計視聴時間を常時表示するオーバーレイと、履歴を一覧できる集計パネル
- 学習以外の視聴時間に任意の1日上限を設定し、超過時に再生をブロック
- YouTube Shorts の自動ブロック／リダイレクト、および関連 UI の非表示
- PC 版 / モバイル版（`m.youtube.com`）どちらでも動作

### 動作要件
- 最新の Chromium / Firefox 系ブラウザ
- ユーザースクリプトマネージャ（Tampermonkey, Violentmonkey, Userscripts など）

### インストール
1. ユーザースクリプトマネージャで新規スクリプトを作成します。
2. `youtube_reason.user.js` の内容をコピーし、管理ツールに貼り付けて保存します。
3. スクリプトを有効化した状態で YouTube を開いて動作を確認してください。

### 使い方
- YouTube で動画を開くと再生前にモーダルが表示されます。カテゴリ（学習／作業／娯楽／その他）と視聴理由を入力すると再生が許可されます。
- 同じ動画へ戻った場合は前回の入力が自動的に承認され、すぐ再生できます。
- 画面右上にその日の視聴時間を示すオーバーレイが表示されます。「集計」ボタンから日別サマリーと直近の理由履歴を確認できます。
- Shorts にアクセスすると設定に応じてブロック／リダイレクトされます。

### 設定
スクリプト冒頭の `CONFIG` オブジェクトを編集して挙動を調整できます。

| 設定キー | 説明 | 既定値 |
| --- | --- | --- |
| `ENABLE_NON_LEARNING_LIMIT` | 学習以外カテゴリの 1 日視聴時間に上限を設けるかどうか | `false` |
| `NON_LEARNING_LIMIT_MIN` | 学習以外カテゴリの視聴時間上限（分） | `30` |
| `MIN_REASON_LEN` | 理由入力の最小文字数 | `5` |
| `MODAL_WIDTH` | 理由入力モーダルの最大幅（px） | `520` |
| `BLOCK_SHORTS` | Shorts 動画への遷移をブロックする | `true` |
| `HIDE_SHORTS_UI` | Shorts 関連のサムネイルやリンクを非表示にする | `true` |
| `SHORTS_REDIRECT_URL` | Shorts にアクセスした際のリダイレクト先（空文字でモーダル表示） | `"/feed/subscriptions"` |
| `SHOW_WATCH_OVERLAY` | 右上の視聴時間オーバーレイを表示する | `true` |
| `ENABLE_SUMMARY_PANEL` | 集計パネル（履歴テーブル）を有効にする | `true` |

設定変更後はスクリプトを保存し、YouTube を再読み込みすると反映されます。

### 保存されるデータ
すべてのデータはブラウザの `localStorage` に保存され、外部へ送信されません。

| 保存キー | 内容 |
| --- | --- |
| `yt_reason_store_v1` | 動画ごとの入力理由とカテゴリ、記録時刻、URL |
| `yt_reason_daily_v1` | 日別の視聴時間（合計／学習／娯楽／その他） |
| `yt_reason_approved_v1` | 再入力を省略してよい動画の承認フラグ |

リセットしたい場合はブラウザの開発者ツールで `localStorage.removeItem('<キー>')` を実行するか、該当ドメインのローカルストレージを削除してください。

### 既知の制限
- オフライン再生や他の拡張機能が動画の再生を制御している場合、カウントが正しく行われない可能性があります。
- YouTube 側の大幅な UI 変更が入った場合、モーダルや UI の挙動に影響が出ることがあります。

### ライセンス
スクリプトと同じライセンスを参照してください（必要に応じて追記）。

## English Guide
This userscript encourages intentional viewing on YouTube by requiring you to enter a reason before playback. It automatically tallies daily watch time for learning versus other categories, and it can block Shorts or enforce an optional daily limit to help you stay focused.

### Key Features
- Require category and viewing reason input before playback (minimum length configurable)
- Automatically track daily watch time for Learning, Entertainment, and Other based on the selected category
- Display a daily watch-time overlay and a summary panel listing history and recent reasons
- Optionally enforce a daily cap for non-learning categories and block playback when the limit is reached
- Block or redirect YouTube Shorts and hide related UI elements
- Works on both desktop and mobile (`m.youtube.com`) versions of YouTube

### Requirements
- A recent Chromium or Firefox based browser
- A userscript manager such as Tampermonkey, Violentmonkey, or Userscripts (macOS)

### Installation
1. Create a new script inside your userscript manager.
2. Copy the contents of `youtube_reason.user.js` and paste them into the manager, then save.
3. Ensure the script is enabled, open YouTube, and confirm it runs as expected.

### Usage
- When you open a video, a modal appears before playback. Select a category (Learning / Work / Entertainment / Other) and enter your reason; playback starts once you submit.
- Returning to the same video reuses the previously approved reason so you can resume immediately.
- A daily watch-time overlay appears in the upper-right corner. Use the `Summary` button to review daily totals and the most recent reasons you logged.
- Visiting Shorts is blocked or redirected according to your configuration.

### Configuration
Adjust the `CONFIG` object at the top of the script to fine-tune behavior.

| Key | Description | Default |
| --- | --- | --- |
| `ENABLE_NON_LEARNING_LIMIT` | Whether to enforce a daily cap on non-learning watch time | `false` |
| `NON_LEARNING_LIMIT_MIN` | Daily limit for non-learning categories (minutes) | `30` |
| `MIN_REASON_LEN` | Minimum character count for the viewing reason | `5` |
| `MODAL_WIDTH` | Maximum width of the reason modal (px) | `520` |
| `BLOCK_SHORTS` | Block navigation to YouTube Shorts | `true` |
| `HIDE_SHORTS_UI` | Hide Shorts-related thumbnails and links | `true` |
| `SHORTS_REDIRECT_URL` | Redirect destination when Shorts are opened (empty string shows a modal) | `"/feed/subscriptions"` |
| `SHOW_WATCH_OVERLAY` | Show the watch-time overlay in the top-right corner | `true` |
| `ENABLE_SUMMARY_PANEL` | Enable the summary panel with history tables | `true` |

Save the script and reload YouTube after changing the configuration.

### Stored Data
All data stays in the browser's `localStorage` and is never transmitted externally.

| Storage Key | Content |
| --- | --- |
| `yt_reason_store_v1` | Reason, category, timestamp, and URL for each recorded video |
| `yt_reason_daily_v1` | Daily watch-time totals (overall / learning / entertainment / other) |
| `yt_reason_approved_v1` | Approval flags for videos that no longer require re-entry |

To reset, clear the relevant keys via developer tools with `localStorage.removeItem('<key>')` or wipe the site's local storage.

### Known Limitations
- Offline playback or other extensions that control the video element may interfere with accurate tracking.
- Significant UI updates on YouTube's side may affect the modal or cleanup logic.

### License
Refer to the script's license (add details here as needed).
