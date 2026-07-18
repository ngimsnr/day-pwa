# day-pwa

個人用パーソナル管理 PWA「Day」。Trade / Food / Training を毎日30秒で記録する。

- 公開先: https://ngimsnr.github.io/day-pwa/ (GitHub Pages, main ブランチ root)
- 記録データはユーザー端末の localStorage のみ。サーバー送信なし

## 設計原則

1. **シンプル・ミニマル維持**。機能は足すより削る。「便利そう」だけでは追加しない
2. 配色は White / Black / Gray のみ。**色で情報を伝えない** (達成も損益の正負もモノクロ+記号)
3. 文言・並び順は固定。動的な並び替え・レコメンド・演出はしない
4. 30秒で記録できることを最優先。タップ数を増やす変更は要注意

## 変更時の必須手順

1. データ形式を変える場合: `js/store.js` の `defaultState` の version を +1 し、`migrate` チェーンに `migrateVN` を追加。**既存端末の記録は必ず保持する**
2. `sw.js` の `VERSION` を +1 (忘れると端末に配信されない)
3. 検証: `node --check js/*.js`。移行を書いたら node で localStorage をスタブし、実機相当データで migrate をテスト
4. push 後、`gh api -X POST repos/ngimsnr/day-pwa/pages/builds` で Pages 再ビルドを実行し、`sw.js` の配信 VERSION を curl で確認 (CDN キャッシュ最大10分)

## 構成

- `index.html` — 画面骨組み (Today / History / 設定 / 追加食材シート)
- `js/store.js` — データ層: 永続化・migrate・集計・固定食材 (`DEFAULT_FOODS`)・トレーニングメニュー (`defaultSchedules`)
- `js/app.js` — UI 層: 描画とイベント
- `sw.js` — オフラインキャッシュ + 自動更新 (新 SW 有効化で自動リロード)
