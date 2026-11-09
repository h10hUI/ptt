import { assert, assertEquals } from "jsr:@std/assert@1";

const read = (p: string) => Deno.readTextFileSync(new URL(`../${p}`, import.meta.url));

Deno.test("deno.json: 名前・エントリポイント・依存・タスクを持つ", () => {
  const cfg = JSON.parse(read("deno.json"));
  assertEquals(cfg.name, "@h10hui/ptt");
  assert(typeof cfg.version === "string" && cfg.version.length > 0);
  const exp = typeof cfg.exports === "string" ? cfg.exports : cfg.exports?.["."];
  assertEquals(exp, "./main.ts");
  assert(typeof cfg.imports?.["@cliffy/ansi"] === "string", "@cliffy/ansi の依存が必要");
  assert(cfg.tasks && Object.keys(cfg.tasks).length > 0, "タスクが必要");
});

Deno.test("README: 前提（Node.js 22以上・clasp 3.x）とインストール手順（パーミッション込み）", () => {
  const md = read("README.md");
  for (
    const needle of [
      "Node.js 22",
      "clasp 3",
      "npm install -g @google/clasp",
      "deno install -g -n ptt",
      "--allow-net=script.google.com,script.googleusercontent.com",
      "--allow-run=ioreg,clasp",
      "--allow-env=HOME",
      '--allow-read="$HOME/.local/share/ptt"',
      '--allow-write="$HOME/.local/share/ptt"',
      "jsr:@h10hui/ptt",
      "main.ts",
      "deno install -g -f",
      "deno uninstall -g ptt",
      'export PATH="$HOME/.deno/bin:$PATH"',
    ]
  ) {
    assert(md.includes(needle), `README に「${needle}」がありません`);
  }
});

Deno.test("README: 注意書き（匿名アクセス・URL共有禁止・clasp 実行許可・タイムゾーン・macOS 専用・再セットアップ）", () => {
  const md = read("README.md");
  assert(md.includes("匿名"), "全員（匿名を含む）アクセスの注意");
  assert(/共有/.test(md), "URL を共有しない注意");
  assert(/サンドボックス/.test(md), "clasp 実行許可でサンドボックスが広がる注意");
  assert(/タイムゾーン/.test(md), "タイムゾーン変更の注意");
  assert(md.includes("config.json") && md.includes("gas/"), "再セットアップ手順");
  assert(md.includes("macOS"), "macOS 専用の明記");
});
