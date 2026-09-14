# SetLog Editor

ローカルの動画ファイルに、タイムスタンプ付きのキャプション（setLog風のログ）を付けられるブラウザアプリです。動画はサーバーに送信されず、すべての処理がブラウザ内で完結します。

## 機能

- ローカル動画ファイルの読み込み（ファイル選択 / ドラッグ&ドロップ）
- 再生中に現在時刻へログをマーク（ボタン、またはショートカット `M`）
- ログ一覧からタイムスタンプをクリックしてその位置へシーク
- キャプションのインライン編集・削除
- ログのエクスポート（JSON / SRT字幕 / CSV）
- JSONログの読み込み（続きから編集）
- 動画ファイル名ごとにブラウザの localStorage へ自動保存

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが出力されます。GitHub Pages などにそのまま配置できます。

## デプロイ

`main` ブランチへの push で GitHub Actions (`.github/workflows/deploy.yml`) が自動的に GitHub Pages へデプロイします。リポジトリの Settings > Pages で Source を "GitHub Actions" に設定してください。

## 注意

動画ファイルやログはブラウザ内（メモリ / localStorage）にのみ保持されます。タブを閉じると動画自体の読み込み状態は失われるため、作業内容は適宜 JSON エクスポートで保存してください。
