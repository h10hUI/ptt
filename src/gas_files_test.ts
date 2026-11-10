import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import { buildAppsscriptJson, CODE_JS } from "./gas_files.ts";

const TIME_ZONE = "Asia/Tokyo";

type FakeRange = {
  setNumberFormat: (format: string) => void;
  setValues: (values: unknown[][]) => void;
};

type ValueWrite = {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
  values: unknown[][];
};

type FakeSheet = {
  numberFormats: { range: string; format: string }[];
  valueWrites: ValueWrite[];
  lastRow: number;
  getLastRow: () => number;
  getRange: (a: string | number, b?: number, c?: number, d?: number) => FakeRange;
};

const makeSheet = (lastRow = 0): FakeSheet => {
  const sheet: FakeSheet = {
    numberFormats: [],
    valueWrites: [],
    lastRow,
    getLastRow: () => sheet.lastRow,
    getRange: (a, b, c, d) => ({
      setNumberFormat: (format) => {
        const range = typeof a === "string" ? a : `${a},${b},${c},${d}`;
        sheet.numberFormats.push({ range, format });
      },
      setValues: (values) => {
        if (typeof a === "string") return;
        const numRows = c ?? 0;
        const numCols = d ?? 0;
        sheet.valueWrites.push({ row: a, col: b ?? 0, numRows, numCols, values });
        sheet.lastRow = Math.max(sheet.lastRow, a + numRows - 1);
      },
    }),
  };
  return sheet;
};

type FakeSpreadsheet = {
  id: string;
  timeZone: string;
  sheets: FakeSheet[];
  getId: () => string;
  getUrl: () => string;
  getSheets: () => FakeSheet[];
  setSpreadsheetTimeZone: (timeZone: string) => void;
};

const makeSpreadsheet = (id: string, sheets: FakeSheet[]): FakeSpreadsheet => {
  const ss: FakeSpreadsheet = {
    id,
    timeZone: "",
    sheets,
    getId: () => ss.id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${ss.id}/edit`,
    getSheets: () => ss.sheets,
    setSpreadsheetTimeZone: (timeZone) => {
      ss.timeZone = timeZone;
    },
  };
  return ss;
};

type FakeSpreadsheetApp = {
  created: FakeSpreadsheet[];
  opened: string[];
  create: (title: string) => FakeSpreadsheet;
  openById: (id: string) => FakeSpreadsheet;
};

const makeSpreadsheetApp = (initial: Record<string, FakeSpreadsheet> = {}): FakeSpreadsheetApp => {
  const registry: Record<string, FakeSpreadsheet> = { ...initial };
  const created: FakeSpreadsheet[] = [];
  const opened: string[] = [];
  return {
    created,
    opened,
    create: (_title) => {
      const ss = makeSpreadsheet(`created-${created.length + 1}`, [makeSheet()]);
      registry[ss.id] = ss;
      created.push(ss);
      return ss;
    },
    openById: (id) => {
      opened.push(id);
      const ss = registry[id];
      if (ss === undefined) throw new Error(`unknown spreadsheet: ${id}`);
      return ss;
    },
  };
};

type FakePropertiesService = {
  store: Record<string, string>;
  getScriptProperties: () => {
    getProperty: (key: string) => string | null;
    setProperty: (key: string, value: string) => void;
    deleteProperty: (key: string) => void;
  };
};

const makePropertiesService = (initial: Record<string, string>): FakePropertiesService => {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getScriptProperties: () => ({
      getProperty: (key) => (key in store ? store[key] : null),
      setProperty: (key, value) => {
        store[key] = value;
      },
      deleteProperty: (key) => {
        delete store[key];
      },
    }),
  };
};

type FakeLockService = {
  waits: number[];
  releases: number[];
  getScriptLock: () => {
    waitLock: (ms: number) => void;
    releaseLock: () => void;
  };
};

const makeLockService = (): FakeLockService => {
  const waits: number[] = [];
  const releases: number[] = [];
  return {
    waits,
    releases,
    getScriptLock: () => ({
      waitLock: (ms) => {
        waits.push(ms);
      },
      releaseLock: () => {
        releases.push(1);
      },
    }),
  };
};

type FakeTextOutput = {
  value: unknown;
  mimeType: string;
  setMimeType: (mimeType: string) => FakeTextOutput;
};

type FakeContentService = {
  MimeType: { JSON: string };
  createTextOutput: (value: unknown) => FakeTextOutput;
};

const makeContentService = (): FakeContentService => {
  const createTextOutput = (value: unknown): FakeTextOutput => {
    const output: FakeTextOutput = {
      value,
      mimeType: "",
      setMimeType: (mimeType) => {
        output.mimeType = mimeType;
        return output;
      },
    };
    return output;
  };
  return { createTextOutput, MimeType: { JSON: "application/json" } };
};

type GasEnv = {
  SpreadsheetApp: FakeSpreadsheetApp;
  PropertiesService: FakePropertiesService;
  LockService: FakeLockService;
  Session: { getScriptTimeZone: () => string };
  ContentService: FakeContentService;
  Utilities: {
    parseDate: (value: string, timeZone: string, format: string) => Date;
  };
};

type GasApi = {
  doGet: (e?: { parameter?: Record<string, string> }) => FakeTextOutput;
  doPost: (e: { postData: { contents: string } }) => FakeTextOutput;
};

const makeEnv = (opts: {
  existing?: Record<string, FakeSpreadsheet>;
  properties: Record<string, string>;
}): GasEnv => ({
  SpreadsheetApp: makeSpreadsheetApp(opts.existing),
  PropertiesService: makePropertiesService(opts.properties),
  LockService: makeLockService(),
  Session: { getScriptTimeZone: () => TIME_ZONE },
  ContentService: makeContentService(),
  Utilities: {
    // GAS の parseDate は Date を返す。ここではローカル時刻として解釈する
    parseDate: (value, _timeZone, _format) => new Date(value.replace(" ", "T")),
  },
});

const loadGasApi = (env: GasEnv): GasApi => {
  const factory = new Function(
    "SpreadsheetApp",
    "PropertiesService",
    "LockService",
    "Session",
    "ContentService",
    "Utilities",
    `${CODE_JS}\n;return { doGet: doGet, doPost: doPost };`,
  );
  return factory(
    env.SpreadsheetApp,
    env.PropertiesService,
    env.LockService,
    env.Session,
    env.ContentService,
    env.Utilities,
  ) as GasApi;
};

const responseJson = (output: FakeTextOutput): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(String(output.value));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`JSON オブジェクトではありません: ${String(output.value)}`);
  }
  return parsed as Record<string, unknown>;
};

const asDate = (value: unknown): Date => {
  if (!(value instanceof Date)) throw new Error(`Date ではありません: ${String(value)}`);
  return value;
};

const HEADERS = ["プロジェクト名", "開始日", "開始時刻", "終了日", "終了時刻", "作業時間"];

Deno.test("buildAppsscriptJson: timeZone を埋め込み、V8 / ANYONE_ANONYMOUS / USER_DEPLOYING にする", () => {
  const parsed = JSON.parse(buildAppsscriptJson("Asia/Tokyo"));
  assertEquals(parsed, {
    timeZone: "Asia/Tokyo",
    runtimeVersion: "V8",
    webapp: { access: "ANYONE_ANONYMOUS", executeAs: "USER_DEPLOYING" },
  });
});

Deno.test("buildAppsscriptJson: access は ANYONE ではなく ANYONE_ANONYMOUS のみ", () => {
  const parsed = JSON.parse(buildAppsscriptJson("UTC"));
  assertEquals(parsed.webapp.access === "ANYONE", false);
  assertEquals(parsed.webapp.access, "ANYONE_ANONYMOUS");
});

Deno.test("CODE_JS: 構文として正しく、doGet / doPost を定義する", () => {
  const api = new Function(`${CODE_JS}\n;return { doGet, doPost };`)();
  assertEquals(typeof api.doGet, "function");
  assertEquals(typeof api.doPost, "function");
});

Deno.test("CODE_JS: doGet の応答（status ptt ok・spreadsheetUrl）と共通の取得・作成関数", () => {
  assertStringIncludes(CODE_JS, "ptt ok");
  assertStringIncludes(CODE_JS, "spreadsheetUrl");
  assertStringIncludes(CODE_JS, "ContentService");
  assertStringIncludes(CODE_JS, "SpreadsheetApp.create");
  assertStringIncludes(CODE_JS, "SpreadsheetApp.openById");
  assertStringIncludes(CODE_JS, "e.parameter.setup");
});

Deno.test("CODE_JS: ScriptLock で排他し、スプレッドシートIDをスクリプトプロパティに保存する", () => {
  assertStringIncludes(CODE_JS, "LockService.getScriptLock()");
  assertStringIncludes(CODE_JS, "PropertiesService.getScriptProperties()");
  assertStringIncludes(CODE_JS, "SETUP_ID");
});

Deno.test("CODE_JS: 作成時のタイトル ptt・スクリプトのタイムゾーン・6列の見出し行", () => {
  assertMatch(CODE_JS, /create\(\s*['"]ptt['"]/);
  assertStringIncludes(CODE_JS, "Session.getScriptTimeZone()");
  for (const h of HEADERS) {
    assertStringIncludes(CODE_JS, h);
  }
});

Deno.test("CODE_JS: A列は @、B・D列は yyyy-mm-dd、C・E列は hh:mm:ss、F列は [h]:mm:ss", () => {
  assertMatch(CODE_JS, /['"]@['"]/);
  assertStringIncludes(CODE_JS, "yyyy-mm-dd");
  assertStringIncludes(CODE_JS, "hh:mm:ss");
  assertStringIncludes(CODE_JS, "[h]:mm:ss");
  assertEquals(CODE_JS.includes("yyyy-mm-dd hh:mm:ss"), false);
});

Deno.test("CODE_JS: 旧4列の見出し・移行処理を持たない", () => {
  assertEquals(CODE_JS.includes("開始日時"), false);
  assertEquals(CODE_JS.includes("終了日時"), false);
  assertEquals(CODE_JS.includes("setValues(rows)"), true);
  assertEquals(CODE_JS.includes("1, rows.length, 4"), false);
});

Deno.test("CODE_JS: doPost は text/plain 本文を JSON.parse し、durationSec / 86400 を書き込む", () => {
  assertStringIncludes(CODE_JS, "e.postData.contents");
  assertStringIncludes(CODE_JS, "JSON.parse");
  assertMatch(CODE_JS, /durationSec\s*\/\s*86400/);
  assertStringIncludes(CODE_JS, "records");
});

Deno.test("CODE_JS: doPost の応答は成功 {ok:true,count}・失敗 {ok:false,error}", () => {
  assertMatch(CODE_JS, /ok:\s*true/);
  assertMatch(CODE_JS, /count/);
  assertMatch(CODE_JS, /ok:\s*false/);
  assertMatch(CODE_JS, /error/);
});

Deno.test("GAS: 初回セットアップで6列の見出し・列書式の新しいシートを作成しURLを返す", () => {
  const env = makeEnv({ properties: {} });
  const api = loadGasApi(env);

  const body = responseJson(api.doGet({ parameter: { setup: "T1" } }));

  assertEquals(body, {
    status: "ptt ok",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/created-1/edit",
  });
  assertEquals(env.SpreadsheetApp.created.length, 1);
  const ss = env.SpreadsheetApp.created[0];
  assertEquals(ss.timeZone, TIME_ZONE);
  assertEquals(ss.sheets[0].numberFormats, [
    { range: "A:A", format: "@" },
    { range: "B:B", format: "yyyy-mm-dd" },
    { range: "C:C", format: "hh:mm:ss" },
    { range: "D:D", format: "yyyy-mm-dd" },
    { range: "E:E", format: "hh:mm:ss" },
    { range: "F:F", format: "[h]:mm:ss" },
  ]);
  assertEquals(ss.sheets[0].valueWrites, [
    { row: 1, col: 1, numRows: 1, numCols: 6, values: [HEADERS] },
  ]);
  assertEquals(env.PropertiesService.store, { SPREADSHEET_ID: "created-1", SETUP_ID: "T1" });
  assertEquals(env.LockService.waits, [30000]);
  assertEquals(env.LockService.releases.length, 1);
});

Deno.test("GAS: 旧4列シートを保存した状態からのセットアップは新シートを作り、旧シートを開かない", () => {
  const legacySheet = makeSheet(3);
  const legacy = makeSpreadsheet("legacy-id", [legacySheet]);
  const env = makeEnv({ existing: { "legacy-id": legacy }, properties: { SPREADSHEET_ID: "legacy-id" } });
  const api = loadGasApi(env);

  const body = responseJson(api.doGet({ parameter: { setup: "T1" } }));

  assertEquals(body.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/created-1/edit");
  assertEquals(env.SpreadsheetApp.created.length, 1);
  assertEquals(env.SpreadsheetApp.opened, []);
  assertEquals(env.PropertiesService.store, { SPREADSHEET_ID: "created-1", SETUP_ID: "T1" });
  assertEquals(legacySheet.valueWrites, []);
  assertEquals(legacySheet.numberFormats, []);
});

Deno.test("GAS: 再セットアップは新しいシートを作り、同じセットアップIDでは作り直さない", () => {
  const previousSheet = makeSheet(4);
  const previous = makeSpreadsheet("current-id", [previousSheet]);
  const env = makeEnv({
    existing: { "current-id": previous },
    properties: { SPREADSHEET_ID: "current-id", SETUP_ID: "T1" },
  });
  const api = loadGasApi(env);

  const body = responseJson(api.doGet({ parameter: { setup: "T2" } }));
  assertEquals(body.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/created-1/edit");
  assertEquals(env.SpreadsheetApp.created.length, 1);
  assertEquals(env.SpreadsheetApp.opened, []);
  assertEquals(env.PropertiesService.store, { SPREADSHEET_ID: "created-1", SETUP_ID: "T2" });
  assertEquals(previousSheet.valueWrites, []);
  assertEquals(previousSheet.numberFormats, []);

  // 承認ポーリングやリロードで同じセットアップ ID の GET が繰り返されても増やさない
  const again = responseJson(api.doGet({ parameter: { setup: "T2" } }));
  assertEquals(again.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/created-1/edit");
  assertEquals(env.SpreadsheetApp.created.length, 1);
  assertEquals(env.SpreadsheetApp.opened, ["created-1"]);

  // 以後の追記先は新しいシート
  const posted = responseJson(api.doPost({
    postData: {
      contents: JSON.stringify({
        records: [{
          project: "ptt",
          start: "2026-10-30 22:45:00",
          end: "2026-10-30 23:58:12",
          durationSec: 4392,
        }],
      }),
    },
  }));
  assertEquals(posted, { ok: true, count: 1 });
  assertEquals(env.SpreadsheetApp.opened, ["created-1", "created-1"]);
  assertEquals(previousSheet.valueWrites, []);
  assertEquals(env.SpreadsheetApp.created[0].sheets[0].valueWrites.length, 2);
});

Deno.test("GAS: doPost は開始・終了を日付と時刻の4セルに分け、複数レコードを6セルで一括追記する", () => {
  const sheet = makeSheet(5);
  const current = makeSpreadsheet("current-id", [sheet]);
  const env = makeEnv({
    existing: { "current-id": current },
    properties: { SPREADSHEET_ID: "current-id", SETUP_ID: "T1" },
  });
  const api = loadGasApi(env);

  const body = responseJson(api.doPost({
    postData: {
      contents: JSON.stringify({
        records: [
          {
            project: "ptt",
            start: "2026-10-30 22:45:00",
            end: "2026-10-30 23:58:12",
            durationSec: 4392,
          },
          {
            project: "other",
            start: "2026-10-31 00:00:00",
            end: "2026-10-31 01:30:00",
            durationSec: 5400,
          },
        ],
      }),
    },
  }));

  assertEquals(body, { ok: true, count: 2 });
  assertEquals(sheet.valueWrites.length, 1);
  const write = sheet.valueWrites[0];
  assertEquals([write.row, write.col, write.numRows, write.numCols], [6, 1, 2, 6]);
  assertEquals(write.values.length, 2);

  const start = new Date("2026-10-30T22:45:00").getTime();
  const end = new Date("2026-10-30T23:58:12").getTime();
  assertEquals(write.values[0][0], "ptt");
  assertEquals(asDate(write.values[0][1]).getTime(), start);
  assertEquals(asDate(write.values[0][2]).getTime(), start);
  assertEquals(asDate(write.values[0][3]).getTime(), end);
  assertEquals(asDate(write.values[0][4]).getTime(), end);
  assertEquals(write.values[0][5], 4392 / 86400);

  const nextStart = new Date("2026-10-31T00:00:00").getTime();
  const nextEnd = new Date("2026-10-31T01:30:00").getTime();
  assertEquals(write.values[1][0], "other");
  assertEquals(asDate(write.values[1][1]).getTime(), nextStart);
  assertEquals(asDate(write.values[1][2]).getTime(), nextStart);
  assertEquals(asDate(write.values[1][3]).getTime(), nextEnd);
  assertEquals(asDate(write.values[1][4]).getTime(), nextEnd);
  assertEquals(write.values[1][5], 5400 / 86400);
  assertEquals(sheet.lastRow, 7);
});

Deno.test("GAS: doPost は records が配列でなければ {ok:false,error} を返し、追記しない", () => {
  const sheet = makeSheet(1);
  const current = makeSpreadsheet("current-id", [sheet]);
  const env = makeEnv({
    existing: { "current-id": current },
    properties: { SPREADSHEET_ID: "current-id", SETUP_ID: "T1" },
  });
  const api = loadGasApi(env);

  const body = responseJson(api.doPost({
    postData: { contents: JSON.stringify({ records: "not-array" }) },
  }));

  assertEquals(body.ok, false);
  assertEquals(typeof body.error, "string");
  assertEquals(sheet.valueWrites, []);
});
