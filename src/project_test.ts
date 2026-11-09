import { assertEquals } from "jsr:@std/assert@1";
import { normalizeProjectName } from "./project.ts";

Deno.test("normalizeProjectName: 制御文字 U+0000-001F / U+007F-009F を除去する", () => {
  assertEquals(normalizeProjectName("/work/a\tb\nc\u007f\u0085d"), "abcd");
  assertEquals(normalizeProjectName("/work/\u0000x\u001fy\u009fz"), "xyz");
});

Deno.test("normalizeProjectName: ディレクトリ名のみを使い、親パスは含めない", () => {
  assertEquals(normalizeProjectName("/Users/h10h/workspace/ptt"), "ptt");
  assertEquals(normalizeProjectName("/other/place/ptt"), "ptt");
});

Deno.test("normalizeProjectName: 数式文字など記号は変換しない", () => {
  assertEquals(normalizeProjectName("/work/=SUM(A1)"), "=SUM(A1)");
  assertEquals(normalizeProjectName("/work/+cmd|'x'"), "+cmd|'x'");
  assertEquals(normalizeProjectName("/work/@a-b_c d"), "@a-b_c d");
});

Deno.test("normalizeProjectName: 制御文字だけの名前は / になる", () => {
  assertEquals(normalizeProjectName("/work/\n\t"), "/");
});

Deno.test("normalizeProjectName: ルートディレクトリは / になる", () => {
  assertEquals(normalizeProjectName("/"), "/");
});

Deno.test("normalizeProjectName: 制御文字の範囲外（U+00A0 など）は除去しない", () => {
  assertEquals(normalizeProjectName("/work/a b"), "a b");
  assertEquals(normalizeProjectName("/work/日本語 dir"), "日本語 dir");
});
