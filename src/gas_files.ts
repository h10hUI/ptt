export const buildAppsscriptJson = (timeZone: string): string =>
  JSON.stringify(
    {
      timeZone,
      runtimeVersion: "V8",
      webapp: { access: "ANYONE_ANONYMOUS", executeAs: "USER_DEPLOYING" },
    },
    null,
    2,
  ) + "\n";

export const CODE_JS = `var SPREADSHEET_ID_KEY = "SPREADSHEET_ID";
var SETUP_ID_KEY = "SETUP_ID";

function createSpreadsheet_() {
  var ss = SpreadsheetApp.create('ptt');
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  var sheet = ss.getSheets()[0];
  sheet.getRange("A:A").setNumberFormat("@");
  sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("C:C").setNumberFormat("hh:mm:ss");
  sheet.getRange("D:D").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("E:E").setNumberFormat("hh:mm:ss");
  sheet.getRange("F:F").setNumberFormat("[h]:mm:ss");
  sheet.getRange(1, 1, 1, 6).setValues([["プロジェクト名", "開始日", "開始時刻", "終了日", "終了時刻", "作業時間"]]);
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_KEY, ss.getId());
  return ss;
}

function getOrCreateSpreadsheet_(setupId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (setupId && props.getProperty(SETUP_ID_KEY) !== setupId) {
      props.deleteProperty(SPREADSHEET_ID_KEY);
      props.setProperty(SETUP_ID_KEY, setupId);
    }
    var id = props.getProperty(SPREADSHEET_ID_KEY);
    if (id) {
      return SpreadsheetApp.openById(id);
    }
    return createSpreadsheet_();
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var setupId = e && e.parameter && e.parameter.setup ? String(e.parameter.setup) : "";
  var ss = getOrCreateSpreadsheet_(setupId);
  return json_({ status: "ptt ok", spreadsheetUrl: ss.getUrl() });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var records = body.records;
    if (!Array.isArray(records)) {
      throw new Error("records must be an array");
    }
    var tz = Session.getScriptTimeZone();
    var rows = records.map(function (r) {
      var start = Utilities.parseDate(r.start, tz, "yyyy-MM-dd HH:mm:ss");
      var end = Utilities.parseDate(r.end, tz, "yyyy-MM-dd HH:mm:ss");
      var durationSec = Number(r.durationSec);
      return [
        String(r.project),
        start,
        start,
        end,
        end,
        durationSec / 86400
      ];
    });
    var ss = getOrCreateSpreadsheet_("");
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (rows.length > 0) {
        var sheet = ss.getSheets()[0];
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
      }
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, count: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
`;
