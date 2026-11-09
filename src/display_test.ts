import { assert, assertEquals, assertFalse, assertNotEquals } from "jsr:@std/assert@1";
import type { BlockPalette, Display, DisplayOptions, DisplaySize } from "./display.ts";
import { createDisplay } from "./display.ts";
import { formatElapsed } from "./time.ts";

// CSI は表示幅に含めない。色（SGR）も同じ正規表現で落とせる。
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;

const stripAnsi = (text: string): string => text.replace(ANSI_CSI, "");

const linesOf = (text: string): string[] => stripAnsi(text).replace(/\n$/, "").split("\n");

const widthOf = (text: string): number => [...text].length;

const identityPalette: BlockPalette = {
  digits: (text: string) => text,
  colonLit: (text: string) => text,
  colonDim: (text: string) => text,
};

// 字形を変えずに「どの色付け関数が適用されたか」だけを観測できるようにする。
// 点灯・消灯で同じ長さのマーカーを使い、レイアウト比較を成立させる。
const markerPalette: BlockPalette = {
  digits: (text: string) => `{${text}}`,
  colonLit: (text: string) => `[${text}]`,
  colonDim: (text: string) => `(${text})`,
};

const removePaletteMarkers = (text: string): string => text.replace(/[{}()\[\]]/g, "");

type HarnessInput = {
  isTerminal?: boolean;
  size?: () => DisplaySize | null;
  colorEnabled?: boolean;
  palette?: BlockPalette;
};

const makeDisplay = (input: HarnessInput = {}): { writes: string[]; display: Display } => {
  const writes: string[] = [];
  const options: DisplayOptions = {
    isTerminal: input.isTerminal ?? true,
    write: (text) => {
      writes.push(text);
    },
    size: input.size ?? (() => ({ columns: 80, rows: 24 })),
    colorEnabled: input.colorEnabled ?? true,
    palette: input.palette ?? identityPalette,
  };
  return { writes, display: createDisplay(options) };
};

const blockWidthAt = (elapsedSec: number): number => {
  const { writes, display } = makeDisplay();
  display.live(elapsedSec);
  // 1フレームが複数の書き込みに分かれていても表示内容を測れるようにする。
  return widthOf(linesOf(writes.join(""))[0]);
};

// 消去より先に本文を書くと前の表示が残るため、消去シーケンスが本文より前にあることを確認する。
const assertEraseBeforeBody = (out: string, bodyText: string): void => {
  const upIndex = out.indexOf("\x1b[4A");
  const eraseIndex = out.indexOf("\x1b[0J");
  const bodyIndex = out.indexOf(bodyText);
  assert(upIndex >= 0);
  assert(eraseIndex >= 0);
  assert(bodyIndex >= 0, `本文が見つからない: ${bodyText}`);
  assert(upIndex < bodyIndex);
  assert(eraseIndex < bodyIndex);
};

Deno.test("createDisplay: 端末でないときはライブ表示も停止表示も出力しない", () => {
  const { writes, display } = makeDisplay({ isTerminal: false });
  display.live(5);
  display.message("停止しました（0:05:00を記録）");
  assertEquals(writes, []);
});

Deno.test("createDisplay: 端末でないときは端末サイズを問い合わせない", () => {
  let sizeCalled = false;
  const { display } = makeDisplay({
    isTerminal: false,
    size: () => {
      sizeCalled = true;
      return { columns: 80, rows: 24 };
    },
  });
  display.live(5);
  display.message("停止しました（0:05:00を記録）");
  assertFalse(sizeCalled);
});

Deno.test("createDisplay: 十分な端末では5行のブロック数字を1回の書き込みで表示する", () => {
  const { writes, display } = makeDisplay();
  display.live(4392);

  assertEquals(writes.length, 1);
  const body = stripAnsi(writes[0]);
  assertEquals(linesOf(writes[0]).length, 5);
  assert(body.includes("█"));
  assertEquals(/[0-9]/.test(body), false);
  assertEquals(/\p{Extended_Pictographic}/u.test(body), false);
  assertFalse(body.includes(formatElapsed(4392)));
  assertFalse(writes[0].endsWith("\n"));
});

Deno.test("createDisplay: ブロック数字の本文は経過時間の時分秒を反映して変わる", () => {
  const bodyAt = (elapsedSec: number): string => {
    const { writes, display } = makeDisplay();
    display.live(elapsedSec);
    const lines = linesOf(writes[0]);
    assertEquals(lines.length, 5);
    return lines.join("\n");
  };

  assertNotEquals(bodyAt(0), bodyAt(1));
  assertNotEquals(bodyAt(59), bodyAt(60));
});

Deno.test("createDisplay: ブロック数字の5行は同じ表示幅になる", () => {
  const { writes, display } = makeDisplay();
  display.live(4392);

  const lines = linesOf(writes[0]);
  assertEquals(lines.length, 5);
  assertEquals(new Set(lines.map(widthOf)).size, 1);
});

Deno.test("createDisplay: 時は2桁ゼロ埋めで、1桁から2桁になっても表示幅が変わらない", () => {
  assertEquals(blockWidthAt(0), blockWidthAt(4392));
  assertEquals(blockWidthAt(0), blockWidthAt(3599));
  assertEquals(blockWidthAt(3599), blockWidthAt(3600));
  assertEquals(blockWidthAt(3600), blockWidthAt(359999));
});

Deno.test("createDisplay: 100時間以上では時の桁が3桁になり表示幅が増える", () => {
  const ninetyNineHours = blockWidthAt(359999);
  const hundredHours = blockWidthAt(360000);

  assert(hundredHours > ninetyNineHours);
});

Deno.test("createDisplay: 2フレーム目以降は5行上へ戻してから再描画する", () => {
  const { writes, display } = makeDisplay();
  display.live(0);
  display.live(1);

  assertEquals(writes.length, 2);
  assertEraseBeforeBody(writes[1], "█");
});

Deno.test("createDisplay: コロンは点灯と消灯を交互に切り替え、同じ図形のまま色だけ変える", () => {
  const { writes, display } = makeDisplay({ palette: markerPalette });
  display.live(4392);
  display.live(4392);
  display.live(4392);

  const frames = writes.map(stripAnsi);
  assert(frames[0].includes("{"));
  assert(frames[0].includes("["));
  assertFalse(frames[0].includes("("));

  assert(frames[1].includes("("));
  assertFalse(frames[1].includes("["));

  assert(frames[2].includes("["));
  assertFalse(frames[2].includes("("));

  const layouts = frames.map(removePaletteMarkers);
  assertEquals(layouts[0], layouts[1]);
  assertEquals(layouts[1], layouts[2]);
});

Deno.test("createDisplay: 1行表示のあいだはコロンの点滅状態を進めない", () => {
  let current: DisplaySize | null = { columns: 80, rows: 4 };
  const { writes, display } = makeDisplay({ size: () => current, palette: markerPalette });
  display.live(0);

  current = { columns: 80, rows: 24 };
  display.live(1);

  const block = stripAnsi(writes[1]);
  assert(block.includes("["));
  assertFalse(block.includes("("));
});

Deno.test("createDisplay: 幅がブロック表示に足りるときだけブロックし、1列足りないと1行表示へ切り替える", () => {
  let current: DisplaySize | null = { columns: 200, rows: 24 };
  const { writes, display } = makeDisplay({ size: () => current, palette: markerPalette });
  display.live(0);
  // マーカーは表示幅ではない。色付け前の図形幅で境界を判断できることを確かめる。
  const blockWidth = widthOf(removePaletteMarkers(linesOf(writes.join(""))[0]));

  current = { columns: blockWidth, rows: 24 };
  display.live(0);
  const blockLines = linesOf(writes[1]).map(removePaletteMarkers);
  assertEquals(blockLines.length, 5);
  for (const line of blockLines) {
    assert(widthOf(line) <= blockWidth);
  }

  current = { columns: blockWidth - 1, rows: 24 };
  display.live(0);
  const fallback = linesOf(writes[2]);
  assertEquals(fallback.length, 1);
  assert(fallback[0].includes(formatElapsed(0)));
  assert(widthOf(fallback[0]) <= blockWidth - 1);
  assertEquals(/[{}()\[\]]/.test(fallback[0]), false);
});

Deno.test("createDisplay: 高さが5行に足りないときは1行の H:mm:ss を表示する", () => {
  const { writes, display } = makeDisplay({ size: () => ({ columns: 80, rows: 4 }) });
  display.live(0);

  assertEquals(linesOf(writes[0]).length, 1);
  assert(stripAnsi(writes[0]).includes(formatElapsed(0)));
  assertFalse(writes[0].includes("\n"));
});

Deno.test("createDisplay: 1行表示へのフォールバックも1回の書き込みで行う", () => {
  const { writes, display } = makeDisplay({ size: () => ({ columns: 80, rows: 4 }) });
  display.live(0);

  assertEquals(writes.length, 1);
});

Deno.test("createDisplay: 高さがちょうど5行ならブロック表示にする", () => {
  const { writes, display } = makeDisplay({ size: () => ({ columns: 80, rows: 5 }) });
  display.live(0);

  assertEquals(linesOf(writes[0]).length, 5);
});

Deno.test("createDisplay: 端末サイズを取得できないときは1行の H:mm:ss にする", () => {
  const { writes, display } = makeDisplay({ size: () => null });
  display.live(0);

  assertEquals(linesOf(writes[0]).length, 1);
  assert(stripAnsi(writes[0]).includes(formatElapsed(0)));
});

Deno.test("createDisplay: サイズ不足で切り替えた1行表示は装飾しない", () => {
  const { writes, display } = makeDisplay({
    size: () => ({ columns: 80, rows: 4 }),
    palette: markerPalette,
  });
  display.live(3600);

  const body = stripAnsi(writes[0]);
  assertEquals(linesOf(writes[0]).length, 1);
  assert(body.includes("1:00:00"));
  assertEquals(/[{}()\[\]]/.test(body), false);
  assertEquals(/\x1b\[[0-9;]*m/.test(writes[0]), false);
});

Deno.test("createDisplay: 色を使えない端末では色なしの1行 H:mm:ss を表示する", () => {
  let paletteCalled = false;
  const palette: BlockPalette = {
    digits: (text: string) => {
      paletteCalled = true;
      return text;
    },
    colonLit: (text: string) => {
      paletteCalled = true;
      return text;
    },
    colonDim: (text: string) => {
      paletteCalled = true;
      return text;
    },
  };
  const { writes, display } = makeDisplay({ colorEnabled: false, palette });
  display.live(4392);

  const out = writes[0];
  assertEquals(linesOf(out).length, 1);
  assert(stripAnsi(out).includes("1:13:12"));
  assertFalse(paletteCalled);
  assertEquals(/\x1b\[[0-9;]*m/.test(out), false);
});

Deno.test("createDisplay: ブロック表示から1行表示に切り替わるときは5行分を消去してから書く", () => {
  let current: DisplaySize | null = { columns: 200, rows: 24 };
  const { writes, display } = makeDisplay({ size: () => current });
  display.live(0);
  const blockWidth = widthOf(linesOf(writes.join(""))[0]);

  current = { columns: blockWidth - 1, rows: 24 };
  display.live(1);

  const out = writes[1];
  assertEraseBeforeBody(out, formatElapsed(1));
  assertEquals(linesOf(out).length, 1);
  assert(stripAnsi(out).includes(formatElapsed(1)));
  assertFalse(stripAnsi(out).includes("█"));
});

Deno.test("createDisplay: ブロック表示の停止時は5行分を消去して無装飾の1行メッセージだけを出す", () => {
  const { writes, display } = makeDisplay({ palette: markerPalette });
  display.live(4392);
  display.message("停止しました（1:13:12を記録）");

  const out = writes[1];
  assert(out.includes("\x1b[4A"));
  assert(out.includes("\x1b[0J"));
  assertEraseBeforeBody(out, "停止しました（1:13:12を記録）");
  const body = stripAnsi(out);
  assertEquals(linesOf(out).length, 1);
  assert(body.includes("停止しました（1:13:12を記録）"));
  assertFalse(body.includes("█"));
  assertEquals(/\x1b\[[0-9;]*m/.test(out), false);
  assert(out.endsWith("\n"));
});

Deno.test("createDisplay: 1行表示の停止時は同じ行を消して無装飾の1行メッセージを出す", () => {
  const { writes, display } = makeDisplay({ size: () => ({ columns: 80, rows: 4 }) });
  display.live(5);
  display.message("1分未満のため記録しませんでした");

  const out = writes[1];
  assert(out.includes("\x1b[2K"));
  assertFalse(out.includes("\x1b[4A"));
  assertEquals(linesOf(out).length, 1);
  assert(stripAnsi(out).includes("1分未満のため記録しませんでした"));
  assert(out.endsWith("\n"));
});
