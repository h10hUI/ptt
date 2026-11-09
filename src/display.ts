import { tty } from "@cliffy/ansi/tty";
import { formatElapsed } from "./time.ts";

export type Display = {
  live: (elapsedSec: number) => void;
  message: (text: string) => void;
};

export type DisplayOptions = {
  isTerminal: boolean;
  write: (text: string) => void;
};

export const createDisplay = ({ isTerminal, write }: DisplayOptions): Display => {
  const decoder = new TextDecoder();
  const term = tty({
    writer: {
      writeSync: (p: Uint8Array): number => {
        write(decoder.decode(p));
        return p.length;
      },
    },
  });
  return {
    live: (elapsedSec) => {
      if (!isTerminal) return;
      term.cursorLeft.eraseLine();
      write(formatElapsed(elapsedSec));
    },
    message: (text) => {
      if (!isTerminal) return;
      term.cursorLeft.eraseLine();
      write(`${text}\n`);
    },
  };
};
