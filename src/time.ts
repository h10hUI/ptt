const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export const truncateToSecond = (d: Date): Date =>
  new Date(Math.floor(d.getTime() / 1000) * 1000);

export const formatLocal = (d: Date): string =>
  `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export const formatElapsed = (totalSec: number): string => {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${pad(m)}:${pad(s)}`;
};

export const toOffsetIso = (d: Date): string => {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

export const parseOffsetIso = (s: string): Date => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`日時を解釈できません: ${s}`);
  }
  return d;
};
