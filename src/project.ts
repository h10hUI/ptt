import { basename } from "@std/path";

// deno-lint-ignore no-control-regex -- 仕様 4.1 が制御文字の除去を定めている
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export const normalizeProjectName = (dirPath: string): string => {
  const name = basename(dirPath).replace(CONTROL_CHARS, "");
  return name === "" || name === "/" ? "/" : name;
};
