# ptt

ptt（PTT Time Tracking）は、カレントディレクトリをプロジェクトとして自動でタイムトラッキングを行う、ターミナル常駐型の CLI ツールです。計測結果は Google Apps Script（GAS）経由で Google スプレッドシートに送信します。

- コマンド名: `ptt`
- 実装言語: Deno（TypeScript）
- 対応 OS: **macOS 専用**（アイドル検知に `ioreg` を使うため）
- 配布: JSR（`jsr:@h10hui/ptt`）

## 前提

- Node.js 22 以上（clasp 3.x の動作要件）
- clasp 3.x（`@google/clasp`）

```sh
npm install -g @google/clasp
```

## インストール

インストール時に一度だけ実行します。以降は `ptt` で起動します。

```sh
# JSR からインストール（配布時）
deno install -g -n ptt \
  --allow-net=script.google.com,script.googleusercontent.com \
  --allow-run=ioreg,clasp \
  --allow-env=HOME \
  --allow-read="$HOME/.local/share/ptt" \
  --allow-write="$HOME/.local/share/ptt" \
  jsr:@h10hui/ptt

# ローカルのソースからインストール（開発時）
deno install -g -n ptt \
  --allow-net=script.google.com,script.googleusercontent.com \
  --allow-run=ioreg,clasp \
  --allow-env=HOME \
  --allow-read="$HOME/.local/share/ptt" \
  --allow-write="$HOME/.local/share/ptt" \
  main.ts

# PATH が通っていない場合（~/.zshrc）
export PATH="$HOME/.deno/bin:$PATH"

# パーミッション変更時は -f を付けて再インストール
deno install -g -f -n ptt \
  --allow-net=script.google.com,script.googleusercontent.com \
  --allow-run=ioreg,clasp \
  --allow-env=HOME \
  --allow-read="$HOME/.local/share/ptt" \
  --allow-write="$HOME/.local/share/ptt" \
  <対象>

# アンインストール
deno uninstall -g ptt
```

- ローカルの `main.ts` を指定した場合、コードの修正だけなら再インストールは不要です。
- パーミッションを変更した場合は再インストールが必要です。

## 使い方

任意のディレクトリで `ptt` を実行すると、そのディレクトリ名をプロジェクト名として計測を開始します。サブコマンドや操作はありません。

停止条件は、シグナル（SIGHUP / SIGINT / SIGTERM）の受信、30 分のアイドル、スリープの検知です。停止すると記録をスプレッドシートへ送信して終了します。1 分未満の記録は送信しません。

初回起動時（`~/.local/share/ptt/config.json` が無いとき）は、clasp による GAS のセットアップが自動で行われます。ブラウザでの認証・アクセス許可のみが必要です。

## 注意事項

- **GAS の Web アプリは「全員（匿名を含む）」がアクセスできる設定です。** URL を知っていれば誰でも書き込めるため、Web アプリの URL（`config.json` の `gasUrl`）を他人に共有しないでください。
- **`clasp` の実行を許可（`--allow-run=ioreg,clasp`）すると、サンドボックスの制限は実質的に clasp の権限まで広がります。** サブプロセスは Deno のサンドボックスの外で動作します。初回セットアップの手作業をなくすためのトレードオフです。
- **端末のタイムゾーンを変更した場合は、`~/.local/share/ptt/config.json` と `~/.local/share/ptt/gas/` を削除して再セットアップしてください。** GAS 側のタイムゾーンはセットアップ時の端末のタイムゾーンに合わせているため、変更後はずれが生じます。
- macOS 専用です。

## 再セットアップ

- `~/.local/share/ptt/config.json` を削除して `ptt` を再起動します。
- `gas/` が残っている場合は、既存の GAS プロジェクトに再デプロイし、同じスプレッドシートへの書き込みを続けます。
- GAS プロジェクトとスプレッドシートを作り直したい場合は、`gas/` も削除します（古い GAS とスプレッドシートは Google 側に残ります）。
- `gas/Code.js` と `gas/appsscript.json` は毎回 ptt が上書きします。GAS 側のコードは ptt が管理するもので、編集は想定していません。

## 保存先

保存先は `~/.local/share/ptt` です（`XDG_DATA_HOME` は参照しません）。ディレクトリは `0700`、`config.json` は `0600` で作成します。親ディレクトリ（`~/.local/share`）が無い場合は ptt が作成します（このとき、無かった親ディレクトリも `0700` で作成されます）。

## 開発

```sh
deno task test    # テスト
deno task check   # 型チェック
```
