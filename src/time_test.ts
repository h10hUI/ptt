import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import {
  formatElapsed,
  formatLocal,
  parseOffsetIso,
  toOffsetIso,
  truncateToSecond,
} from "./time.ts";

Deno.test("formatLocal: ローカルタイムを YYYY-MM-DD HH:mm:ss にゼロ埋めで整形する", () => {
  assertEquals(formatLocal(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
  assertEquals(formatLocal(new Date(2026, 9, 30, 23, 58, 12)), "2026-10-30 23:58:12");
});

Deno.test("formatLocal: 秒未満は表示しない", () => {
  assertEquals(formatLocal(new Date(2026, 9, 30, 9, 0, 0, 999)), "2026-10-30 09:00:00");
});

Deno.test("truncateToSecond: 秒未満を切り捨てる（丸めない）", () => {
  const t = truncateToSecond(new Date(2026, 9, 30, 9, 0, 59, 999));
  assertEquals(t.getTime() % 1000, 0);
  assertEquals(formatLocal(t), "2026-10-30 09:00:59");
});

Deno.test("formatElapsed: H:mm:ss 形式（時は桁埋めなし、24時間超も時で継続）", () => {
  assertEquals(formatElapsed(0), "0:00:00");
  assertEquals(formatElapsed(59), "0:00:59");
  assertEquals(formatElapsed(60), "0:01:00");
  assertEquals(formatElapsed(3600), "1:00:00");
  assertEquals(formatElapsed(4392), "1:13:12");
  assertEquals(formatElapsed(90000), "25:00:00");
});

Deno.test("toOffsetIso: オフセット付き ISO 8601、秒未満なし、ローカルのオフセットを使う", () => {
  const d = new Date(2026, 9, 30, 22, 45, 0, 123);
  const s = toOffsetIso(d);
  assertMatch(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assertNotMatch(s, /\.\d+/);
  assertNotMatch(s, /Z$/);
  assertEquals(s.slice(0, 19), "2026-10-30T22:45:00");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  assertEquals(s.slice(19), `${sign}${hh}:${mm}`);
});

Deno.test("parseOffsetIso: 正のオフセット・負のオフセットを正しい時刻に変換する", () => {
  assertEquals(
    parseOffsetIso("2026-10-30T22:45:00+09:00").getTime(),
    Date.UTC(2026, 9, 30, 13, 45, 0),
  );
  assertEquals(
    parseOffsetIso("2026-10-30T22:45:00-05:00").getTime(),
    Date.UTC(2026, 9, 31, 3, 45, 0),
  );
});

Deno.test("toOffsetIso → parseOffsetIso は秒単位で往復できる", () => {
  const d = new Date(2026, 9, 30, 23, 58, 10, 750);
  assertEquals(
    parseOffsetIso(toOffsetIso(d)).getTime(),
    Math.floor(d.getTime() / 1000) * 1000,
  );
});
