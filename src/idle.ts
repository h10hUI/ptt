export const IDLE_LIMIT_MS = 30 * 60 * 1000;

const HID_IDLE = /"HIDIdleTime" = (\d+)/;

export const parseHidIdleMs = (stdout: string): number | null => {
  const m = HID_IDLE.exec(stdout);
  if (m === null) return null;
  return Math.floor(Number(m[1]) / 1_000_000);
};

export type IdleDecision = { stop: false } | { stop: true; endMs: number };

export const evaluateIdle = (idleMs: number | null, detectedMs: number): IdleDecision =>
  idleMs !== null && idleMs >= IDLE_LIMIT_MS
    ? { stop: true, endMs: detectedMs - idleMs }
    : { stop: false };

export const runIoreg = async (): Promise<number | null> => {
  try {
    const out = await new Deno.Command("ioreg", {
      args: ["-c", "IOHIDSystem"],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!out.success) return null;
    return parseHidIdleMs(new TextDecoder().decode(out.stdout));
  } catch {
    return null;
  }
};
