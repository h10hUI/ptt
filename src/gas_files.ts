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

function getOrCreateSpreadsheet_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(SPREADSHEET_ID_KEY);
    if (id) {
      return SpreadsheetApp.openById(id);
    }
    var ss = SpreadsheetApp.create('ptt');
    ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
    var sheet = ss.getSheets()[0];
    sheet.getRange("A:A").setNumberFormat("@");
    sheet.getRange("B:C").setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange("D:D").setNumberFormat("[h]:mm:ss");
    sheet.getRange(1, 1, 1, 4).setValues([["プロジェクト名", "開始日時", "終了日時", "作業時間"]]);
    props.setProperty(SPREADSHEET_ID_KEY, ss.getId());
    return ss;
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  var ss = getOrCreateSpreadsheet_();
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
      var durationSec = Number(r.durationSec);
      return [
        String(r.project),
        Utilities.parseDate(r.start, tz, "yyyy-MM-dd HH:mm:ss"),
        Utilities.parseDate(r.end, tz, "yyyy-MM-dd HH:mm:ss"),
        durationSec / 86400
      ];
    });
    var ss = getOrCreateSpreadsheet_();
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (rows.length > 0) {
        var sheet = ss.getSheets()[0];
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
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
