# Day (PWA 版)

私一人だけが毎日使うパーソナル管理アプリ。30秒で記録できることを最優先。
iPhone の Safari で開いて「ホーム画面に追加」して使う。

- 記録データは **端末内 (localStorage)** に保存。外部送信なし
- Service Worker によるオフライン対応 (一度開けば圏外でも起動・入力可)
- 配色は White / Black / Gray のみ。ダークモード自動対応

## 構成

```
day-pwa/
├── index.html            画面の骨組み (Today / History / 設定 / 追加食材シート)
├── styles.css            モノクロ・カード UI
├── js/
│   ├── store.js          データ層: 永続化・日次生成・集計 (UI 非依存)
│   └── app.js            UI 層: 描画とイベント
├── sw.js                 オフラインキャッシュ (更新時は VERSION を上げる)
├── manifest.webmanifest  ホーム画面追加用
└── icons/                黒地に白「D」(scripts 生成)
```

## 公開手順 (GitHub Pages)

```sh
cd ~/day-pwa
git init && git add -A && git commit -m "Day PWA"
gh repo create day-pwa --public --source=. --push
gh api repos/{owner}/day-pwa/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

数分後に `https://ngimsnr.github.io/day-pwa/` で開ける。

## iPhone での初期設定 (一度だけ)

1. Safari で上記 URL を開く
2. 共有ボタン → **ホーム画面に追加**
3. 以降はホーム画面の「D」アイコンから起動 (フルスクリーン・オフライン対応)

> 重要: 必ず「ホーム画面に追加」して使うこと。Safari のタブのまま使うと、
> 7日間未使用でデータが消される制限 (ITP) の対象になる。ホーム画面追加後は対象外。

## 通知の代替 (リマインダーアプリで一度だけ登録)

Web アプリはローカル通知を送れないため、iOS 標準リマインダーで:

- 朝 9:00 曜日別: 「今日は Upper の日」(月木) / Lower (火金) / ウォーキング (水) / フットサル or ウォーキング (土日)
- 毎日 20:00: 「今日の記録を忘れずに」

トレーニングメニューは `js/store.js` の `defaultSchedules()` で定義 (変更するとアプリ更新時に全端末へ反映)。

## データの安全策

設定画面から:
- **バックアップを書き出す (JSON)** — 全データ。読み込みで完全復元可
- **Trade 記録を書き出す (CSV)** — date, stock, future, total

月1回程度 JSON バックアップを iCloud Drive 等に保存しておくと安心。

## 更新の反映

コードを変更したら `sw.js` の `VERSION` を上げて push。
iPhone 側はアプリを開き直すと裏で新版を取得し、次回起動から反映される。

## 設計メモ

- 集計規則は SwiftUI 版 (`~/Day`) の Aggregator と同一:
  達成率 = 記録がある日の日次達成率の平均 / Training 達成日 = 完了セット ≥ 目標セット / 休み・未来日は分母に入れない
- 「0時の固定食材自動生成」は、画面表示時に日付が変わっていれば新しい日のレコードを生成する方式 (冪等)
- 方向・売買判断・予測・採点に類する機能は持たない。入力と振り返りのみ
