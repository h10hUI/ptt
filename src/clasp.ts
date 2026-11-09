import { isObject } from "./util.ts";

export const CLASP_ARGS = {
  version: ["--version"],
  showAuthorizedUser: ["show-authorized-user", "--json"],
  login: ["login"],
  createScript: ["create-script", "--type", "standalone", "--title", "ptt"],
  push: ["push", "--force"],
  createDeployment: ["create-deployment", "--json"],
  updateDeployment: (deploymentId: string): string[] => ["update-deployment", deploymentId],
} as const;

export type ClaspRun =
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number; stdout: string; stderr: string };

export type ClaspCheck = { ok: true } | { ok: false; message: string };

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

export const runClasp = async (args: readonly string[], cwd?: string): Promise<ClaspRun> => {
  try {
    const out = await new Deno.Command("clasp", {
      args: [...args],
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    return { kind: "exit", code: out.code, stdout: decode(out.stdout), stderr: decode(out.stderr) };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { kind: "not-found" };
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
};

export const runClaspInteractive = async (
  args: readonly string[],
  cwd?: string,
): Promise<ClaspRun> => {
  try {
    const status = await new Deno.Command("clasp", {
      args: [...args],
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    return { kind: "exit", code: status.code, stdout: "", stderr: "" };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { kind: "not-found" };
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
};

const VERSION_RE = /(\d+)\.\d+\.\d+/;

export const parseClaspMajor = (output: string): number | null => {
  const m = VERSION_RE.exec(output);
  return m === null ? null : Number(m[1]);
};

const NODE_MESSAGE = "clasp の実行には Node.js 22以上のインストールが必要です。";
const INSTALL_MESSAGE =
  "clasp が見つかりません。次のコマンドでインストールしてください。\n  npm install -g @google/clasp";
const UPGRADE_MESSAGE =
  "clasp 3.x 以上が必要です。次のコマンドで更新してください。\n  npm install -g @google/clasp@latest";

export const evaluateClaspVersion = (run: ClaspRun): ClaspCheck => {
  if (run.kind === "not-found") return { ok: false, message: INSTALL_MESSAGE };
  if (run.kind === "error") return { ok: false, message: run.message };
  if (run.code !== 0) {
    if (run.code === 127 || run.stderr.includes("node")) {
      return { ok: false, message: NODE_MESSAGE };
    }
    return { ok: false, message: run.stderr };
  }
  const major = parseClaspMajor(run.stdout);
  if (major === null) {
    return { ok: false, message: run.stderr || run.stdout };
  }
  return major < 3 ? { ok: false, message: UPGRADE_MESSAGE } : { ok: true };
};

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";

export const isLoggedIn = (res: { code: number; stdout: string; stderr?: string }): boolean => {
  if (res.code !== 0) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return false;
  }
  return isObject(parsed) && (isNonEmptyString(parsed.email) || isNonEmptyString(parsed.user));
};

const DEPLOYMENT_ID_VALUE = /^AKfyc[\w-]+$/;
const DEPLOYMENT_ID_TEXT = /AKfyc[\w-]+/;

const findIdInJson = (v: unknown): string | null => {
  if (typeof v === "string") return DEPLOYMENT_ID_VALUE.test(v) ? v : null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findIdInJson(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (isObject(v)) {
    for (const item of Object.values(v)) {
      const found = findIdInJson(item);
      if (found !== null) return found;
    }
  }
  return null;
};

export const extractDeploymentId = (output: string): string | null => {
  try {
    const found = findIdInJson(JSON.parse(output));
    if (found !== null) return found;
  } catch {
    // JSON でなければ正規表現にフォールバックする
  }
  const m = DEPLOYMENT_ID_TEXT.exec(output);
  return m === null ? null : m[0];
};
