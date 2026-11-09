import { join } from "@std/path";

export type PttPaths = {
  root: string;
  config: string;
  gasDir: string;
  claspJson: string;
  deploymentJson: string;
  codeJs: string;
  appsscriptJson: string;
  pendingDir: string;
};

export const buildPaths = (home: string): PttPaths => {
  const root = join(home, ".local", "share", "ptt");
  const gasDir = join(root, "gas");
  return {
    root,
    config: join(root, "config.json"),
    gasDir,
    claspJson: join(gasDir, ".clasp.json"),
    deploymentJson: join(gasDir, "deployment.json"),
    codeJs: join(gasDir, "Code.js"),
    appsscriptJson: join(gasDir, "appsscript.json"),
    pendingDir: join(root, "pending"),
  };
};

export const getPaths = (): PttPaths => {
  const home = Deno.env.get("HOME");
  if (home === undefined || home === "") {
    throw new Error("環境変数 HOME が設定されていません");
  }
  return buildPaths(home);
};
