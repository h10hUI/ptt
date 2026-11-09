import { colors } from "@cliffy/ansi/colors";
import {
  CLASP_ARGS,
  evaluateClaspVersion,
  extractDeploymentId,
  isLoggedIn,
  runClasp,
  runClaspInteractive,
} from "./clasp.ts";
import type { ClaspRun } from "./clasp.ts";
import type { PttPaths } from "./paths.ts";
import type { Fetcher } from "./sender.ts";
import {
  ensureDataDirs,
  readDeploymentId,
  writeConfig,
  writeDeploymentId,
  writeGasFiles,
} from "./storage.ts";

export const USER_SETTINGS_URL = "https://script.google.com/home/usersettings";

export type PollSettings = { intervalMs: number; timeoutMs: number };
export const API_ENABLE_POLL: PollSettings = { intervalMs: 5_000, timeoutMs: 600_000 };
export const APPROVAL_POLL: PollSettings = { intervalMs: 3_000, timeoutMs: 600_000 };

export const buildGasUrl = (deploymentId: string): string =>
  `https://script.google.com/macros/s/${deploymentId}/exec`;

export const pollUntil = async (opts: {
  attempt: () => Promise<boolean>;
  intervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}): Promise<boolean> => {
  const startedAt = opts.now();
  while (true) {
    if (await opts.attempt()) return true;
    if (opts.now() - startedAt >= opts.timeoutMs) return false;
    await opts.sleep(opts.intervalMs);
  }
};

export const fetchApproval = async (
  url: string,
  fetcher: Fetcher,
): Promise<{ spreadsheetUrl: string } | null> => {
  try {
    const res = await fetcher(url, { redirect: "follow" });
    const parsed: unknown = JSON.parse(await res.text());
    if (typeof parsed !== "object" || parsed === null) return null;
    const body = parsed as Record<string, unknown>;
    if (body.status !== "ptt ok" || typeof body.spreadsheetUrl !== "string") return null;
    return { spreadsheetUrl: body.spreadsheetUrl };
  } catch {
    return null;
  }
};

export type SetupPlan = {
  createProject: boolean;
  deployMode: "create" | "update";
};

export const planSetup = (state: {
  hasClaspJson: boolean;
  hasDeploymentId: boolean;
}): SetupPlan => ({
  createProject: !state.hasClaspJson,
  // 新しいプロジェクトを作る場合、古い deployment.json の ID は別プロジェクトのものなので使わない
  deployMode: state.hasClaspJson && state.hasDeploymentId ? "update" : "create",
});

export const isAppsScriptApiDisabled = (output: string): boolean =>
  (/Apps Script API/i.test(output) && /(not enabled|disabled|not been used)/i.test(output)) ||
  output.includes("home/usersettings");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const exists = (path: string): boolean => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

const describeRun = (run: ClaspRun): string => {
  if (run.kind === "not-found") return "clasp が見つかりません";
  if (run.kind === "error") return run.message;
  return run.stderr || run.stdout;
};

const succeeded = (run: ClaspRun): run is Extract<ClaspRun, { kind: "exit" }> =>
  run.kind === "exit" && run.code === 0;

const checkLogin = async (): Promise<boolean> => {
  const run = await runClasp(CLASP_ARGS.showAuthorizedUser);
  return run.kind === "exit" &&
    isLoggedIn({ code: run.code, stdout: run.stdout, stderr: run.stderr });
};

const indent = "      ";
const info = (text: string): void => console.log(`${indent}${text}`);
const ok = (text: string): void => console.log(`${indent}${colors.green("✓")} ${text}`);
const fail = (text: string): void => console.error(colors.red(text));
const timedOut = (what: string): false => {
  fail(`${what}がタイムアウトしました。もう一度 ptt を実行すると続きから再開できます。`);
  return false;
};

export type SetupResult = { gasUrl: string; spreadsheetUrl: string } | null;

const stepLogin = async (): Promise<boolean> => {
  console.log("\n[1/4] claspのログインを確認しています...");
  if (!(await checkLogin())) {
    info("未ログインのため、ブラウザでログインしてください。");
    await runClaspInteractive(CLASP_ARGS.login);
    if (!(await checkLogin())) {
      fail("claspのログインを確認できませんでした。");
      return false;
    }
  }
  ok("ログインしました");
  return true;
};

const stepCreateProject = async (paths: PttPaths): Promise<boolean> => {
  console.log("\n[2/4] GASプロジェクトを作成しています...");
  Deno.mkdirSync(paths.gasDir, { recursive: true });
  let notified = false;
  const created = await pollUntil({
    ...API_ENABLE_POLL,
    sleep,
    now: () => Date.now(),
    attempt: async () => {
      if (exists(paths.claspJson)) return true;
      const run = await runClasp(CLASP_ARGS.createScript, paths.gasDir);
      if (exists(paths.claspJson)) return true;
      if (!notified) {
        const output = describeRun(run);
        if (isAppsScriptApiDisabled(output)) {
          info("Google Apps Script APIが無効です。以下のURLを開いてオンにしてください。");
          info(USER_SETTINGS_URL);
          info("有効化を待っています...");
        } else {
          info(`作成に失敗しました。再試行します: ${output.trim()}`);
        }
        notified = true;
      }
      return false;
    },
  });
  if (!created) return timedOut("GAS APIの有効化待ち");
  ok("作成しました");
  return true;
};

const stepDeploy = async (paths: PttPaths, plan: SetupPlan): Promise<string | null> => {
  console.log("\n[3/4] アップロードとデプロイを行っています...");
  writeGasFiles(paths, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const push = await runClasp(CLASP_ARGS.push, paths.gasDir);
  if (!succeeded(push)) {
    fail(describeRun(push));
    return null;
  }
  const existingId = readDeploymentId(paths);
  let deploymentId: string;
  if (plan.deployMode === "update" && existingId !== null) {
    const update = await runClasp(CLASP_ARGS.updateDeployment(existingId), paths.gasDir);
    if (!succeeded(update)) {
      fail(describeRun(update));
      return null;
    }
    deploymentId = existingId;
  } else {
    const create = await runClasp(CLASP_ARGS.createDeployment, paths.gasDir);
    if (!succeeded(create)) {
      fail(describeRun(create));
      return null;
    }
    const extracted = extractDeploymentId(create.stdout) ?? extractDeploymentId(create.stderr);
    if (extracted === null) {
      fail(`デプロイIDを取得できませんでした。clasp の出力:\n${create.stdout}${create.stderr}`);
      return null;
    }
    deploymentId = extracted;
  }
  writeDeploymentId(paths, deploymentId);
  ok("デプロイしました");
  return deploymentId;
};

const stepApproval = async (gasUrl: string): Promise<string | null> => {
  console.log("\n[4/4] 以下のURLを開いて、アクセスを許可してください。");
  info(gasUrl);
  info("承認を待っています...");
  let spreadsheetUrl: string | null = null;
  const approved = await pollUntil({
    ...APPROVAL_POLL,
    sleep,
    now: () => Date.now(),
    attempt: async () => {
      const result = await fetchApproval(gasUrl, (u, init) => fetch(u, init));
      if (result === null) return false;
      spreadsheetUrl = result.spreadsheetUrl;
      return true;
    },
  });
  if (!approved || spreadsheetUrl === null) {
    timedOut("アクセス承認待ち");
    return null;
  }
  ok("承認を確認しました");
  return spreadsheetUrl;
};

export const runSetup = async (paths: PttPaths): Promise<SetupResult> => {
  console.log("GASのセットアップを開始します。");
  const version = await runClasp(CLASP_ARGS.version);
  const check = evaluateClaspVersion(version);
  if (!check.ok) {
    fail(check.message);
    return null;
  }
  ensureDataDirs(paths);
  const plan = planSetup({
    hasClaspJson: exists(paths.claspJson),
    hasDeploymentId: readDeploymentId(paths) !== null,
  });
  if (!(await stepLogin())) return null;
  if (plan.createProject && !(await stepCreateProject(paths))) return null;
  if (!plan.createProject) {
    console.log("\n[2/4] GASプロジェクトを作成しています...");
    ok("作成済みです");
  }
  const deploymentId = await stepDeploy(paths, plan);
  if (deploymentId === null) return null;
  const gasUrl = buildGasUrl(deploymentId);
  const spreadsheetUrl = await stepApproval(gasUrl);
  if (spreadsheetUrl === null) return null;
  writeConfig(paths, { gasUrl, spreadsheetUrl });
  console.log("\nセットアップが完了しました。");
  console.log(`スプレッドシート：${spreadsheetUrl}`);
  console.log("計測を開始します。");
  return { gasUrl, spreadsheetUrl };
};
