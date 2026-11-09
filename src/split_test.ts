import { assertEquals } from "jsr:@std/assert@1";
import { splitByDay } from "./split.ts";
import { formatLocal, truncateToSecond } from "./time.ts";

Deno.test("splitByDay: 日付をまたぐ記録は翌日 00:00:00 を境界に2件へ分割され、合計が元と一致する", () => {
  const start = new Date(2026, 9, 30, 23, 0, 0);
  const end = new Date(2026, 9, 31, 1, 30, 0);
  const records = splitByDay("ptt", start, end);
  assertEquals(records, [
    { project: "ptt", start: "2026-10-30 23:00:00", end: "2026-10-31 00:00:00", durationSec: 3600 },
    { project: "ptt", start: "2026-10-31 00:00:00", end: "2026-10-31 01:30:00", durationSec: 5400 },
  ]);
  assertEquals(records.reduce((a, r) => a + r.durationSec, 0), 9000);
});

Deno.test("splitByDay: 日付をまたがない記録は1件のまま", () => {
  const records = splitByDay(
    "ptt",
    new Date(2026, 9, 30, 9, 0, 0),
    new Date(2026, 9, 30, 10, 0, 0),
  );
  assertEquals(records, [
    { project: "ptt", start: "2026-10-30 09:00:00", end: "2026-10-30 10:00:00", durationSec: 3600 },
  ]);
});

Deno.test("splitByDay: ちょうど 00:00:00 に終了する記録は翌日側に0秒の区間を作らない", () => {
  const records = splitByDay(
    "ptt",
    new Date(2026, 9, 30, 23, 0, 0),
    new Date(2026, 9, 31, 0, 0, 0),
  );
  assertEquals(records, [
    { project: "ptt", start: "2026-10-30 23:00:00", end: "2026-10-31 00:00:00", durationSec: 3600 },
  ]);
});

Deno.test("splitByDay: 3日をまたぐ記録は中間日が24時間の区間になる", () => {
  const records = splitByDay(
    "ptt",
    new Date(2026, 9, 29, 22, 0, 0),
    new Date(2026, 9, 31, 2, 0, 0),
  );
  assertEquals(records.map((r) => [r.start, r.end, r.durationSec]), [
    ["2026-10-29 22:00:00", "2026-10-30 00:00:00", 7200],
    ["2026-10-30 00:00:00", "2026-10-31 00:00:00", 86400],
    ["2026-10-31 00:00:00", "2026-10-31 02:00:00", 7200],
  ]);
});

Deno.test("splitByDay: 秒未満は切り捨ててから作業時間を計算する", () => {
  const records = splitByDay(
    "ptt",
    new Date(2026, 9, 30, 9, 0, 0, 900),
    new Date(2026, 9, 30, 9, 0, 59, 100),
  );
  assertEquals(records, [
    { project: "ptt", start: "2026-10-30 09:00:00", end: "2026-10-30 09:00:59", durationSec: 59 },
  ]);
});

Deno.test("splitByDay: 作業時間0の記録は区間を作らない", () => {
  const t = new Date(2026, 9, 30, 9, 0, 0);
  assertEquals(splitByDay("ptt", t, t), []);
});

Deno.test("splitByDay: 区間は連続し、合計が元の秒数と一致し、各区間は24時間以内（複数ケース）", () => {
  const cases: [Date, Date][] = [
    [new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 0, 1, 0, 0, 1)],
    [new Date(2026, 0, 1, 23, 59, 59), new Date(2026, 0, 2, 0, 0, 1)],
    [new Date(2026, 1, 27, 12, 0, 0), new Date(2026, 2, 2, 12, 0, 0)],
    [new Date(2026, 11, 31, 20, 15, 30, 400), new Date(2027, 0, 2, 1, 2, 3, 900)],
  ];
  for (const [start, end] of cases) {
    const records = splitByDay("p", start, end);
    const s = truncateToSecond(start);
    const e = truncateToSecond(end);
    const total = (e.getTime() - s.getTime()) / 1000;
    assertEquals(records.reduce((a, r) => a + r.durationSec, 0), total);
    assertEquals(records[0].start, formatLocal(s));
    assertEquals(records[records.length - 1].end, formatLocal(e));
    for (let i = 1; i < records.length; i++) {
      assertEquals(records[i].start, records[i - 1].end);
      assertEquals(records[i].start.slice(11), "00:00:00");
    }
    for (const r of records) {
      assertEquals(r.durationSec > 0 && r.durationSec <= 86400, true);
      assertEquals(Number.isInteger(r.durationSec), true);
    }
  }
});
