import { assert, assertEquals } from "jsr:@std/assert@1";

const START_TIMEOUT_MS = 10_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const readFirstLine = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> => {
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) return buffer.length > 0 ? buffer : null;
    buffer += decoder.decode(value, { stream: true });
  }
  return buffer.slice(0, buffer.indexOf("\n"));
};

const readProcessName = async (pid: number): Promise<string> => {
  const out = await new Deno.Command("ps", {
    args: ["-o", "comm=", "-p", String(pid)],
    stdout: "piped",
    stderr: "null",
  }).output();
  assert(out.success, `ps -o comm= -p ${pid} が失敗しました`);
  return new TextDecoder().decode(out.stdout).trim();
};

// 子プロセスの生成元。本番コードをそのまま import するため、テスト側で process.title を直接代入しない
const childScript = (moduleUrl: string): string =>
  [
    `import { setProcessTitle } from ${JSON.stringify(moduleUrl)};`,
    "",
    "setProcessTitle();",
    'console.log("ready");',
    "await new Promise((resolve) => setTimeout(resolve, 30_000));",
    "",
  ].join("\n");

// 子が既に終了している場合の kill は TypeError になる（後始末の対象が無いだけなので無視する）
const terminate = (child: Deno.ChildProcess): void => {
  try {
    child.kill("SIGKILL");
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
  }
};

Deno.test("プロセス名: 起動時に設定した名前が ps の comm で観測される", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ptt-process-title-" });
  try {
    const scriptPath = `${dir}/child.ts`;
    await Deno.writeTextFile(scriptPath, childScript(new URL("./process_title.ts", import.meta.url).href));

    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--quiet", "-A", scriptPath],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const reader = child.stdout.getReader();

    try {
      const ready = await withTimeout(
        readFirstLine(reader),
        START_TIMEOUT_MS,
        "子プロセスの起動を待てませんでした",
      );
      if (ready === null) {
        const stderr = await new Response(child.stderr).text();
        throw new Error(`子プロセスが ready を出力せず終了しました: ${stderr.trim()}`);
      }
      assertEquals(ready, "ready", "子プロセスの ready 出力を確認できませんでした");

      assertEquals(await readProcessName(child.pid), "ptt");
    } finally {
      await reader.cancel();
      terminate(child);
      await child.status;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("配線: main.ts が起動処理の前に setProcessTitle を呼ぶ", () => {
  const main = Deno.readTextFileSync(new URL("../main.ts", import.meta.url));
  assert(main.includes('from "./src/process_title.ts"'), "main.ts が process_title.ts を import していません");
  const callIndex = main.search(/^setProcessTitle\(\);$/m);
  assert(callIndex >= 0, "main.ts がトップレベルで setProcessTitle() を呼んでいません");
  const exitIndex = main.indexOf("Deno.exit(await main())");
  assert(exitIndex >= 0, "main.ts に起動処理が見つかりません");
  assert(callIndex < exitIndex, "setProcessTitle() が起動処理より後に呼ばれています");
});
