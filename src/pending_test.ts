import { assertEquals } from "jsr:@std/assert@1";
import {
  claimPending,
  collectResendTargets,
  isResendTarget,
  isStaleSending,
  pendingFileName,
  readPending,
  restorePending,
  writePendingAtomic,
} from "./pending.ts";
import type { PendingRecord } from "./pending.ts";
import { toOffsetIso } from "./time.ts";

const NOW = new Date(2026, 9, 30, 12, 0, 0);
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);
const rec = (lastAliveAgoSec: number): PendingRecord => ({
  project: "ptt",
  start: toOffsetIso(ago(lastAliveAgoSec + 3600)),
  lastAlive: toOffsetIso(ago(lastAliveAgoSec)),
});
const tmp = () => Deno.makeTempDirSync({ prefix: "ptt-pending-" });
const names = (dir: string) => [...Deno.readDirSync(dir)].map((e) => e.name).sort();

Deno.test("pendingFileName: <PID>-<開始エポックms>.json", () => {
  assertEquals(pendingFileName(12345, 1793367900000), "12345-1793367900000.json");
});

Deno.test("writePendingAtomic: 内容を書き、一時ファイルを残さない。上書きで更新できる", () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writePendingAtomic(path, rec(0));
  assertEquals(readPending(path), rec(0));
  const updated = { ...rec(0), lastAlive: toOffsetIso(ago(-10)) };
  writePendingAtomic(path, updated);
  assertEquals(readPending(path), updated);
  assertEquals(names(dir), ["1-1.json"]);
});

Deno.test("writePendingAtomic: 内容は project / start / lastAlive のみの JSON", () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writePendingAtomic(path, rec(0));
  const parsed = JSON.parse(Deno.readTextFileSync(path));
  assertEquals(Object.keys(parsed).sort(), ["lastAlive", "project", "start"]);
});

Deno.test("claimPending: .json を .sending にリネームして処理権を得る。2回目は null", () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writePendingAtomic(path, rec(100));
  const sending = claimPending(path);
  assertEquals(sending, `${dir}/1-1.sending`);
  assertEquals(names(dir), ["1-1.sending"]);
  assertEquals(claimPending(path), null);
});

Deno.test("claimPending: ファイルが無ければ null（何もしない）", () => {
  const dir = tmp();
  assertEquals(claimPending(`${dir}/none.json`), null);
  assertEquals(names(dir), []);
});

Deno.test("restorePending: .sending を .json に戻し、内容を保つ", () => {
  const dir = tmp();
  const path = `${dir}/1-1.json`;
  writePendingAtomic(path, rec(100));
  const before = Deno.readTextFileSync(path);
  const sending = claimPending(path)!;
  assertEquals(restorePending(sending), path);
  assertEquals(names(dir), ["1-1.json"]);
  assertEquals(Deno.readTextFileSync(path), before);
});

Deno.test("isResendTarget: 最終生存時刻が60秒以上前なら対象（59秒前は対象外）", () => {
  assertEquals(isResendTarget(toOffsetIso(ago(59)), NOW), false);
  assertEquals(isResendTarget(toOffsetIso(ago(60)), NOW), true);
  assertEquals(isResendTarget(toOffsetIso(ago(3600)), NOW), true);
  assertEquals(isResendTarget(toOffsetIso(ago(10)), NOW), false);
});

Deno.test("isStaleSending: 更新日時が2分以上前なら復旧対象（119秒前は対象外）", () => {
  assertEquals(isStaleSending(ago(119), NOW), false);
  assertEquals(isStaleSending(ago(120), NOW), true);
  assertEquals(isStaleSending(ago(30), NOW), false);
});

Deno.test("collectResendTargets: 古い .json のみ対象。更新中の .json と一時ファイルは対象外", () => {
  const dir = tmp();
  writePendingAtomic(`${dir}/1-1.json`, rec(600));
  writePendingAtomic(`${dir}/2-2.json`, rec(10));
  writePendingAtomic(`${dir}/3-3.json`, rec(61));
  Deno.writeTextFileSync(`${dir}/4-4.json.tmp`, "{}");
  const targets = collectResendTargets(dir, NOW).sort();
  assertEquals(targets, [`${dir}/1-1.json`, `${dir}/3-3.json`]);
});

Deno.test("collectResendTargets: 2分以上前の .sending は .json に戻して対象に含め、新しい .sending は触らない", () => {
  const dir = tmp();
  writePendingAtomic(`${dir}/5-5.json`, rec(900));
  writePendingAtomic(`${dir}/6-6.json`, rec(900));
  claimPending(`${dir}/5-5.json`);
  claimPending(`${dir}/6-6.json`);
  Deno.utimeSync(`${dir}/5-5.sending`, ago(180), ago(180));
  Deno.utimeSync(`${dir}/6-6.sending`, ago(30), ago(30));
  const targets = collectResendTargets(dir, NOW);
  assertEquals(targets, [`${dir}/5-5.json`]);
  assertEquals(names(dir), ["5-5.json", "6-6.sending"]);
});

Deno.test("claimPending: 古い .json を claim した直後の .sending は、更新日時が現在になり復旧されない", () => {
  const dir = tmp();
  const path = `${dir}/7-7.json`;
  writePendingAtomic(path, rec(900));
  const old = new Date(Date.now() - 180_000);
  Deno.utimeSync(path, old, old);
  const sending = claimPending(path)!;
  const mtime = Deno.statSync(sending).mtime!;
  assertEquals(Date.now() - mtime.getTime() < 120_000, true);
  assertEquals(collectResendTargets(dir, new Date()), []);
  assertEquals(names(dir), ["7-7.sending"]);
});

Deno.test("collectResendTargets: 2分以上前の .tmp と .sent は削除し、新しいものは残す", () => {
  const dir = tmp();
  Deno.writeTextFileSync(`${dir}/7-7.json.tmp`, "{}");
  Deno.writeTextFileSync(`${dir}/8-8.sending.sent`, "{}");
  Deno.writeTextFileSync(`${dir}/9-9.json.tmp`, "{}");
  Deno.utimeSync(`${dir}/7-7.json.tmp`, ago(180), ago(180));
  Deno.utimeSync(`${dir}/8-8.sending.sent`, ago(180), ago(180));
  Deno.utimeSync(`${dir}/9-9.json.tmp`, ago(30), ago(30));
  assertEquals(collectResendTargets(dir, NOW), []);
  assertEquals(names(dir), ["9-9.json.tmp"]);
});
