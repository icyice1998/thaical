/**
 * Batched, gentle table reader — never runs one big query.
 *
 * The shop PC / MySQL 4.0 crashes on a large single query, but paging with
 * LIMIT offset,pageSize and a pause between pages (background trickle) is safe
 * (tested). This reads a table page by page into a Google Sheet and stops when
 * a short page comes back. Shares conn_() with Code.gs.
 *
 * Edit the CONFIG constants, then run batchReadToSheet().
 */
function batchReadToSheet() {
  // ---- CONFIG ----
  var TABLE    = 'tb_product';   // table to read
  var COLUMNS  = '*';            // or an explicit list: 'product_id, product_name, ...'
  var WHERE    = '';             // e.g. "product_active <> '0'"  (no leading WHERE)
  var ORDERBY  = '';             // recommended key for stable paging, e.g. 'product_id'
  var PAGE     = 300;            // rows per page — small = gentle on the DB
  var SLEEPMS  = 400;            // pause between pages (ms) — the background trickle
  var MAXPAGES = 2000;           // safety cap
  // ----------------

  var where = WHERE ? ' WHERE ' + WHERE : '';
  var order = ORDERBY ? ' ORDER BY ' + ORDERBY : '';

  var ss = SpreadsheetApp.create(TABLE + '_' + new Date().toISOString().slice(0, 19));
  var sh = ss.getActiveSheet();
  var wroteHeader = false, offset = 0, total = 0;

  var c = conn_();
  try {
    var st = c.createStatement();
    for (var p = 0; p < MAXPAGES; p++) {
      var sql = 'SELECT ' + COLUMNS + ' FROM `' + TABLE + '`' + where + order +
                ' LIMIT ' + offset + ', ' + PAGE;
      var rs = st.executeQuery(sql);
      var meta = rs.getMetaData();
      var n = meta.getColumnCount();

      if (!wroteHeader) {
        var head = [];
        for (var i = 1; i <= n; i++) head.push(meta.getColumnLabel(i));
        sh.appendRow(head);
        wroteHeader = true;
      }

      var rows = [], cnt = 0;
      while (rs.next()) {
        var row = [];
        for (var j = 1; j <= n; j++) { var v = rs.getString(j); row.push(v === null ? '' : v); }
        rows.push(row);
        cnt++;
      }
      rs.close();

      if (cnt > 0) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, n).setValues(rows);
        total += cnt;
      }
      Logger.log('page ' + p + '  offset ' + offset + '  got ' + cnt + '  (total ' + total + ')');

      if (cnt < PAGE) break;       // short page => last page
      offset += PAGE;
      Utilities.sleep(SLEEPMS);    // keep the DB calm between pages
    }
    st.close();
  } finally {
    c.close();
  }
  Logger.log('DONE  ' + total + ' rows  ->  ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * Keyset variant — lighter than deep OFFSET on large tables.
 * Instead of skipping offset rows (which the server still scans), it pages by a
 * strictly increasing key: WHERE key > lastSeen ORDER BY key LIMIT PAGE.
 * Use this for big tables (sales history); OFFSET is fine for small ones.
 */
function batchReadKeyset() {
  // ---- CONFIG ----
  var TABLE   = 'tb_saledetail';
  var KEY     = 'id';            // a unique, increasing column
  var COLUMNS = '*';
  var WHERE   = '';              // extra filter (no leading WHERE), ANDed with the key
  var PAGE    = 500;
  var SLEEPMS = 400;
  var MAXPAGES = 5000;
  // ----------------

  var ss = SpreadsheetApp.create(TABLE + '_ks_' + new Date().toISOString().slice(0, 19));
  var sh = ss.getActiveSheet();
  var wroteHeader = false, last = null, total = 0;

  var c = conn_();
  try {
    var st = c.createStatement();
    for (var p = 0; p < MAXPAGES; p++) {
      var cond = (last === null ? '' : '`' + KEY + '` > ' + quote_(last)) +
                 (WHERE ? (last === null ? '' : ' AND ') + WHERE : '');
      var where = cond ? ' WHERE ' + cond : '';
      var sql = 'SELECT ' + COLUMNS + ' FROM `' + TABLE + '`' + where +
                ' ORDER BY `' + KEY + '` LIMIT ' + PAGE;
      var rs = st.executeQuery(sql);
      var meta = rs.getMetaData();
      var n = meta.getColumnCount();
      var keyIdx = -1;
      if (!wroteHeader) {
        var head = [];
        for (var i = 1; i <= n; i++) { head.push(meta.getColumnLabel(i)); if (meta.getColumnLabel(i) === KEY) keyIdx = i; }
        sh.appendRow(head);
        wroteHeader = true;
      } else {
        for (var k = 1; k <= n; k++) if (meta.getColumnLabel(k) === KEY) keyIdx = k;
      }

      var rows = [], cnt = 0;
      while (rs.next()) {
        var row = [];
        for (var j = 1; j <= n; j++) { var v = rs.getString(j); row.push(v === null ? '' : v); }
        rows.push(row);
        last = rs.getString(keyIdx);
        cnt++;
      }
      rs.close();

      if (cnt > 0) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, n).setValues(rows);
        total += cnt;
      }
      Logger.log('page ' + p + '  last ' + KEY + '=' + last + '  got ' + cnt + '  (total ' + total + ')');

      if (cnt < PAGE) break;
      Utilities.sleep(SLEEPMS);
    }
    st.close();
  } finally {
    c.close();
  }
  Logger.log('DONE  ' + total + ' rows  ->  ' + ss.getUrl());
  return ss.getUrl();
}

function quote_(v) {
  return /^-?\d+$/.test(String(v)) ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
}
