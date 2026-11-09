import {
  claimPending,
  collectResendTargets,
  readPending,
  restorePending,
} from "./pending.ts";
import { splitByDay } from "./split.ts";
import type { SendRecord } from "./split.ts";
import { parseOffsetIso } from "./time.ts";

export const SEND_ATTEMPTS = 3;
export const SEND_TIMEOUT_MS = 10_000;
export const SEND_RETRY_INTERVAL_MS = 2_000;

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export type SendDeps = {
  url: string;
  fetcher: Fetcher;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export type SendOutcome = "sent" | "skipped" | "failed";

const isOkResponse = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as Record<string, unknown>).ok === true;

export const postRecords = async (
  url: string,
  records: SendRecord[],
  opts: { timeoutMs: number; fetcher: Fetcher },
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ records }),
      signal: controller.signal,
    });
    const body = await res.text();
    return isOkResponse(JSON.parse(body));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const sendPendingFile = async (path: string, deps: SendDeps): Promise<SendOutcome> => {
  const sending = claimPending(path);
  if (sending === null) return "skipped";
  let records: SendRecord[];
  try {
    const rec = readPending(sending);
    records = splitByDay(rec.project, parseOffsetIso(rec.start), parseOffsetIso(rec.lastAlive));
  } catch {
    restorePending(sending);
    return "failed";
  }
  const timeoutMs = deps.timeoutMs ?? SEND_TIMEOUT_MS;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    if (await postRecords(deps.url, records, { timeoutMs, fetcher: deps.fetcher })) {
      Deno.removeSync(sending);
      return "sent";
    }
    if (attempt < SEND_ATTEMPTS) await deps.sleep(SEND_RETRY_INTERVAL_MS);
  }
  restorePending(sending);
  return "failed";
};

export const resendStale = async (
  dir: string,
  now: Date,
  deps: SendDeps,
): Promise<SendOutcome[]> => {
  const outcomes: SendOutcome[] = [];
  for (const path of collectResendTargets(dir, now)) {
    outcomes.push(await sendPendingFile(path, deps));
  }
  return outcomes;
};
