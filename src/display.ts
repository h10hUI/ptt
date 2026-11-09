import { ansi } from "jsr:@cliffy/ansi@^1.3.1";
import { colors } from "jsr:@cliffy/ansi@^1.3.1/colors";
import { formatElapsed } from "./time.ts";

export type Display = {
  live: (elapsedSec: number) => void;
  message: (text: string) => void;
};

export type DisplaySize = { columns: number; rows: number };

export type BlockPalette = {
  digits: (text: string) => string;
  colonLit: (text: string) => string;
  colonDim: (text: string) => string;
};

export type DisplayOptions = {
  isTerminal: boolean;
  write: (text: string) => void;
  size: () => DisplaySize | null;
  colorEnabled: boolean;
  palette: BlockPalette;
};

export const bluePalette: BlockPalette = {
  digits: (text) => colors.brightBlue(text),
  // dim 属性（SGR 2）は端末によって無視され、点灯と見分けがつかないため、256色で明度差を明示する
  colonLit: (text) => colors.rgb8(text, 33),
  colonDim: (text) => colors.rgb8(text, 17),
};

const BLOCK_HEIGHT = 5;

const DIGIT_GLYPHS: Record<string, string[]> = {
  "0": ["███", "█ █", "█ █", "█ █", "███"],
  "1": ["  █", "  █", "  █", "  █", "  █"],
  "2": ["███", "  █", "███", "█  ", "███"],
  "3": ["███", "  █", "███", "  █", "███"],
  "4": ["█ █", "█ █", "███", "  █", "  █"],
  "5": ["███", "█  ", "███", "  █", "███"],
  "6": ["███", "█  ", "███", "█ █", "███"],
  "7": ["███", "  █", "  █", "  █", "  █"],
  "8": ["███", "█ █", "███", "█ █", "███"],
  "9": ["███", "█ █", "███", "  █", "███"],
};

const COLON_GLYPH = [" ", "█", " ", "█", " "];

type BlockToken = { kind: "digits" | "colon"; glyph: string[] };

type RenderKind = "none" | "single" | "block";

const clockTokens = (elapsedSec: number): BlockToken[] => {
  const [h, m, s] = formatElapsed(elapsedSec).split(":");
  const chars = [...`${h.padStart(2, "0")}:${m}:${s}`];
  return chars.map((char) => {
    if (char === ":") return { kind: "colon", glyph: COLON_GLYPH };
    const glyph = DIGIT_GLYPHS[char];
    if (glyph === undefined) throw new Error(`ブロック数字の字形がありません: ${char}`);
    return { kind: "digits", glyph };
  });
};

// 色付けは表示幅に影響するため、可否判定は色付け前の図形文字列で行う
const plainWidth = (tokens: BlockToken[]): number =>
  [...tokens.map((token) => token.glyph[0]).join(" ")].length;

const blockLines = (
  tokens: BlockToken[],
  colonLit: boolean,
  palette: BlockPalette,
): string[] => {
  const colorOf = (token: BlockToken): ((text: string) => string) =>
    token.kind === "digits" ? palette.digits : colonLit ? palette.colonLit : palette.colonDim;
  return Array.from({ length: BLOCK_HEIGHT }, (_, row) =>
    tokens.map((token) => colorOf(token)(token.glyph[row])).join(" ")
  );
};

export const createDisplay = (options: DisplayOptions): Display => {
  const { isTerminal, write, size, colorEnabled, palette } = options;
  let rendered: RenderKind = "none";
  let renderedWidth = 0;

  // 描画後に端末幅が狭まると各行が折り返すため、現在の幅での物理行数ぶんカーソルを戻す
  const blockPhysicalRows = (): number => {
    const columns = size()?.columns;
    if (columns === undefined || columns <= 0) return BLOCK_HEIGHT;
    return BLOCK_HEIGHT * Math.max(1, Math.ceil(renderedWidth / columns));
  };

  const erasePrefix = (): string =>
    rendered === "block"
      ? ansi.cursorUp(blockPhysicalRows() - 1).cursorLeft.eraseDown.toString()
      : ansi.cursorLeft.eraseLine.toString();

  return {
    live: (elapsedSec) => {
      if (!isTerminal) return;
      const tokens = clockTokens(elapsedSec);
      const currentSize = size();
      const canBlock = colorEnabled && currentSize !== null &&
        currentSize.columns >= plainWidth(tokens) && currentSize.rows >= BLOCK_HEIGHT;
      if (!canBlock) {
        write(`${erasePrefix()}${formatElapsed(elapsedSec)}`);
        rendered = "single";
        return;
      }
      // 点滅は経過秒の偶奇で決め、時計の秒と位相を一致させる
      const colonLit = elapsedSec % 2 === 0;
      write(`${erasePrefix()}${blockLines(tokens, colonLit, palette).join("\n")}`);
      rendered = "block";
      renderedWidth = plainWidth(tokens);
    },
    message: (text) => {
      if (!isTerminal) return;
      write(`${erasePrefix()}${text}\n`);
      rendered = "none";
    },
  };
};
