import { formatLocal, truncateToSecond } from "./time.ts";

export type SendRecord = {
  project: string;
  start: string;
  end: string;
  durationSec: number;
};

export const splitByDay = (project: string, start: Date, end: Date): SendRecord[] => {
  const s = truncateToSecond(start);
  const e = truncateToSecond(end);
  const records: SendRecord[] = [];
  let cursor = s;
  while (cursor.getTime() < e.getTime()) {
    const nextMidnight = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    const segEnd = nextMidnight.getTime() < e.getTime() ? nextMidnight : e;
    records.push({
      project,
      start: formatLocal(cursor),
      end: formatLocal(segEnd),
      durationSec: (segEnd.getTime() - cursor.getTime()) / 1000,
    });
    cursor = segEnd;
  }
  return records;
};
