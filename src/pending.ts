import { join } from "@std/path";
import { parseOffsetIso } from "./time.ts";

export type PendingRecord = {
  project: string;
  start: string;
  lastAlive: string;
};

const RESEND_AFTER_MS = 60_000;
const STALE_SENDING_MS = 120_000;

const isPendingRecord = (v: unknown): v is PendingRecord => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.project === "string" && typeof r.start === "string" &&
    typeof r.lastAlive === "string";
};

export const pendingFileName = (pid: number, startMs: number): string => `${pid}-${startMs}.json`;

export const writePendingAtomic = (path: string, record: PendingRecord): void => {
  const tmp = `${path}.tmp`;
  Deno.writeTextFileSync(
    tmp,
    JSON.stringify({ project: record.project, start: record.start, lastAlive: record.lastAlive }),
  );
  Deno.renameSync(tmp, path);
};

export const readPending = (path: string): PendingRecord => {
  const parsed: unknown = JSON.parse(Deno.readTextFileSync(path));
  if (!isPendingRecord(parsed)) {
    throw new Error(`退避ファイルの形式が不正です: ${path}`);
  }
  return parsed;
};

const toSendingPath = (jsonPath: string): string => jsonPath.replace(/\.json$/, ".sending");
const toJsonPath = (sendingPath: string): string => sendingPath.replace(/\.sending$/, ".json");

export const claimPending = (jsonPath: string): string | null => {
  const sending = toSendingPath(jsonPath);
  try {
    Deno.renameSync(jsonPath, sending);
  } catch {
    return null;
  }
  // 復旧判定は .sending の更新日時を送信開始時刻とみなすため、claim 時刻に更新する
  // 更新できないと古い更新日時のまま復旧対象になり二重送信になりうるため、戻して未取得扱いにする
  try {
    const now = new Date();
    Deno.utimeSync(sending, now, now);
  } catch {
    try {
      Deno.renameSync(sending, jsonPath);
    } catch {
      // 戻せない場合は .sending のまま復旧処理に任せる
    }
    return null;
  }
  return sending;
};

export const restorePending = (sendingPath: string): string => {
  const json = toJsonPath(sendingPath);
  Deno.renameSync(sendingPath, json);
  return json;
};

export const isResendTarget = (lastAliveIso: string, now: Date): boolean =>
  now.getTime() - parseOffsetIso(lastAliveIso).getTime() >= RESEND_AFTER_MS;

export const isStaleSending = (mtime: Date, now: Date): boolean =>
  now.getTime() - mtime.getTime() >= STALE_SENDING_MS;

export const collectResendTargets = (dir: string, now: Date): string[] => {
  const entries = [...Deno.readDirSync(dir)].filter((e) => e.isFile);
  for (const e of entries) {
    if (!e.name.endsWith(".sending")) continue;
    const path = join(dir, e.name);
    try {
      const mtime = Deno.statSync(path).mtime;
      if (mtime !== null && isStaleSending(mtime, now)) restorePending(path);
    } catch {
      // 他プロセスが処理した場合は何もしない
    }
  }
  const targets: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const path = join(dir, e.name);
    try {
      if (isResendTarget(readPending(path).lastAlive, now)) targets.push(path);
    } catch {
      // 読めない・不正なファイルは対象外
    }
  }
  return targets;
};
