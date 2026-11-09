import { CODE_JS, buildAppsscriptJson } from "./gas_files.ts";
import type { PttPaths } from "./paths.ts";
import { isObject } from "./util.ts";

export type PttConfig = { gasUrl: string; spreadsheetUrl: string };

export const ensureDataDirs = (paths: PttPaths): void => {
  for (const dir of [paths.root, paths.pendingDir]) {
    Deno.mkdirSync(dir, { recursive: true, mode: 0o700 });
    Deno.chmodSync(dir, 0o700);
  }
};

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch (e) {
    // 壊れた JSON（書き込み途中のクラッシュなど）は未作成と同じ扱いにして再セットアップさせる
    if (e instanceof Deno.errors.NotFound || e instanceof SyntaxError) return null;
    throw e;
  }
};

export const writeConfig = (paths: PttPaths, config: PttConfig): void => {
  Deno.writeTextFileSync(paths.config, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  Deno.chmodSync(paths.config, 0o600);
};

export const readConfig = (paths: PttPaths): PttConfig | null => {
  const v = readJson(paths.config);
  if (isObject(v) && typeof v.gasUrl === "string" && typeof v.spreadsheetUrl === "string") {
    return { gasUrl: v.gasUrl, spreadsheetUrl: v.spreadsheetUrl };
  }
  return null;
};

export const readDeploymentId = (paths: PttPaths): string | null => {
  const v = readJson(paths.deploymentJson);
  return isObject(v) && typeof v.deploymentId === "string" && v.deploymentId !== ""
    ? v.deploymentId
    : null;
};

export const writeDeploymentId = (paths: PttPaths, deploymentId: string): void => {
  Deno.mkdirSync(paths.gasDir, { recursive: true });
  Deno.writeTextFileSync(paths.deploymentJson, JSON.stringify({ deploymentId }, null, 2) + "\n");
};

export const writeGasFiles = (paths: PttPaths, timeZone: string): void => {
  Deno.mkdirSync(paths.gasDir, { recursive: true });
  Deno.writeTextFileSync(paths.codeJs, CODE_JS);
  Deno.writeTextFileSync(paths.appsscriptJson, buildAppsscriptJson(timeZone));
};
