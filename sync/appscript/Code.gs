/**
 * drgstr — read-only JDBC access from Google Apps Script.
 *
 * Apps Script runs on Google's servers, which CAN open a raw JDBC/TCP
 * connection to the MySQL 4.0 database exposed via the ngrok tunnel.
 *
 * Credentials live in Script Properties (Project Settings -> Script Properties),
 * never in this file. Set:
 *   DB_HOST   = 1.tcp.ap.ngrok.io
 *   DB_PORT   = 24772
 *   DB_NAME   = drgstr
 *   DB_USER   = <read-only user>
 *   DB_PASS   = <password>
 *   DB_PARAMS = (optional) e.g. useUnicode=true&characterEncoding=TIS620
 *
 * Read-only by convention: only SHOW / DESCRIBE / SELECT.
 * Run testConnection() first, then dumpSchema(), then tableCounts().
 */

function props_() { return PropertiesService.getScriptProperties(); }

function conn_() {
  var p = props_();
  var host = p.getProperty('DB_HOST');
  var port = p.getProperty('DB_PORT') || '3306';
  var name = p.getProperty('DB_NAME');
  var user = p.getProperty('DB_USER');
  var pass = p.getProperty('DB_PASS') || '';
  var extra = p.getProperty('DB_PARAMS') || '';
  if (!host || !name || !user) {
    throw new Error('Set DB_HOST, DB_NAME, DB_USER in Script Properties first.');
  }
  var url = 'jdbc:mysql://' + host + ':' + port + '/' + name + (extra ? '?' + extra : '');
  return Jdbc.getConnection(url, user, pass);
}

/** Connect and print the server version. Run this first. */
function testConnection() {
  var c = conn_();
  var rs = c.createStatement().executeQuery('SELECT VERSION()');
  rs.next();
  var v = rs.getString(1);
  rs.close();
  c.close();
  Logger.log('connected. server version = ' + v);
  return v;
}

/** Dump the full schema (SHOW CREATE TABLE for every table) to a Google Doc. */
function dumpSchema() {
  var c = conn_();
  var st = c.createStatement();
  var rs = st.executeQuery('SHOW TABLES');
  var tables = [];
  while (rs.next()) tables.push(rs.getString(1));
  rs.close();

  var out = ['-- drgstr schema', '-- tables (' + tables.length + '): ' + tables.join(', '), ''];
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    try {
      var r = st.executeQuery('SHOW CREATE TABLE `' + t + '`');
      if (r.next()) out.push(r.getString(2) + ';\n');
      r.close();
    } catch (e) {
      out.push('-- ' + t + ' ERROR: ' + e + '\n');
    }
  }
  st.close();
  c.close();

  var text = out.join('\n');
  var doc = DocumentApp.create('drgstr_schema_' + new Date().toISOString().slice(0, 19));
  doc.getBody().setText(text);
  Logger.log('Schema written to Doc: ' + doc.getUrl());
  Logger.log(text.substring(0, 3000));
  return doc.getUrl();
}

/** Row count per table — to size each table and spot the sales/edit tables. */
function tableCounts() {
  var c = conn_();
  var st = c.createStatement();
  var rs = st.executeQuery('SHOW TABLES');
  var tables = [];
  while (rs.next()) tables.push(rs.getString(1));
  rs.close();

  var out = ['rows\ttable'];
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    try {
      var r = st.executeQuery('SELECT COUNT(*) FROM `' + t + '`');
      r.next();
      out.push(r.getString(1) + '\t' + t);
      r.close();
    } catch (e) {
      out.push('?\t' + t + '\t' + e);
    }
  }
  st.close();
  c.close();
  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/** First n rows of a table as TSV (default 20). Edit TABLE/N then run peek(). */
function peek() {
  var TABLE = 'tb_sale';
  var N = 20;
  Logger.log(queryToTsv_('SELECT * FROM `' + TABLE + '` LIMIT ' + N));
}

/** Run an arbitrary read-only query. Edit SQL then run runQuery(). */
function runQuery() {
  var SQL = 'SHOW TABLES';
  Logger.log(queryToTsv_(SQL));
}

function queryToTsv_(sql) {
  var c = conn_();
  var rs = c.createStatement().executeQuery(sql);
  var meta = rs.getMetaData();
  var n = meta.getColumnCount();
  var head = [];
  for (var i = 1; i <= n; i++) head.push(meta.getColumnLabel(i));
  var lines = [head.join('\t')];
  while (rs.next()) {
    var row = [];
    for (var j = 1; j <= n; j++) {
      var v = rs.getString(j);
      if (v === null) v = '\\N';
      row.push(String(v).replace(/[\t\r\n]/g, ' '));
    }
    lines.push(row.join('\t'));
  }
  rs.close();
  c.close();
  return lines.join('\n');
}
