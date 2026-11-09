import { createDisplay } from "./src/display.ts";
import { runIoreg } from "./src/idle.ts";
import { getPaths } from "./src/paths.ts";
import { pendingFileName, writePendingAtomic } from "./src/pending.ts";
import { normalizeProjectName } from "./src/project.ts";
import { resendStale, sendPendingFile } from "./src/sender.ts";
import type { SendDeps } from "./src/sender.ts";
import { runSetup } from "./src/setup.ts";
import { finalizeStop } from "./src/stop.ts";
import { ensureDataDirs, readConfig } from "./src/storage.ts";
import { toOffsetIso } from "./src/time.ts";
import { runTracker } from "./src/tracker.ts";
import { runBestEffort, sleep } from "./src/util.ts";
import { join } from "@std/path";

const main = async (): Promise<number> => {
  const paths = getPaths();
  ensureDataDirs(paths);

  let config = readConfig(paths);
  if (config === null) {
    config = await runSetup(paths);
    if (config === null) return 1;
  }

  const sendDeps: SendDeps = {
    url: config.gasUrl,
    fetcher: (url, init) => fetch(url, init),
    sleep,
  };
  const resending = resendStale(paths.pendingDir, new Date(), sendDeps).catch(() => []);

  const encoder = new TextEncoder();
  const display = createDisplay({
    isTerminal: Deno.stdout.isTerminal(),
    write: (text) => Deno.stdout.writeSync(encoder.encode(text)),
  });

  const project = normalizeProjectName(Deno.cwd());
  const start = new Date();
  const startIso = toOffsetIso(start);
  const pendingPath = join(paths.pendingDir, pendingFileName(Deno.pid, start.getTime()));
  const writePending = (lastAlive: Date): void =>
    writePendingAtomic(pendingPath, { project, start: startIso, lastAlive: toOffsetIso(lastAlive) });
  writePending(start);

  const result = await runTracker(start.getTime(), {
    now: () => Date.now(),
    showElapsed: (sec) => runBestEffort(() => display.live(sec)),
    writeAlive: writePending,
    readIdleMs: runIoreg,
  });

  const code = await finalizeStop({
    reason: result.reason,
    start,
    end: result.end,
    deps: {
      pendingExists: () => {
        try {
          Deno.statSync(pendingPath);
          return true;
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) return false;
          throw e;
        }
      },
      writePending,
      deletePending: () => {
        try {
          Deno.removeSync(pendingPath);
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e;
        }
      },
      send: async () => (await sendPendingFile(pendingPath, sendDeps)) !== "failed",
      show: display.message,
    },
  });
  await resending;
  return code;
};

try {
  Deno.exit(await main());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  Deno.exit(1);
}
