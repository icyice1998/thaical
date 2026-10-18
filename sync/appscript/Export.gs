/**
 * Lightweight price + stock refresh — the frequent update.
 *
 * The product catalogue (name, category, unit, reorder point) rarely changes;
 * only price and on-hand quantity move. So instead of re-reading all columns,
 * this reads just id + price + qty in gentle batches and writes a small
 * stock.json ({ id -> {price, on_hand} }) that the website overlays onto the
 * full products.json.
 *
 * Fill in the real column names below (from DESCRIBE tb_product or the Sheet
 * header), then run exportStockJson(). Shares conn_() with Code.gs.
 */
function exportStockJson() {
  // ---- CONFIG: set to the real column names ----
  var TABLE = 'tb_product';
  var ID    = 'product_id';      // product code
  var PRICE = 'sale_price';      // selling price
  var QTY   = 'qty_on_hand';     // current stock quantity
  var WHERE = "product_active <> '0'";   // active products only (soft-delete)
  var PAGE  = 300;
  var SLEEPMS = 400;
  var MAXPAGES = 2000;
  // ----------------------------------------------

  var items = {}, offset = 0, total = 0;
  var c = conn_();
  try {
    var st = c.createStatement();
    for (var p = 0; p < MAXPAGES; p++) {
      var sql = 'SELECT `' + ID + '`, `' + PRICE + '`, `' + QTY + '` FROM `' + TABLE + '`' +
                (WHERE ? ' WHERE ' + WHERE : '') +
                ' ORDER BY `' + ID + '` LIMIT ' + offset + ', ' + PAGE;
      var rs = st.executeQuery(sql);
      var cnt = 0;
      while (rs.next()) {
        items[rs.getString(1)] = { price: toNum_(rs.getString(2)), on_hand: toNum_(rs.getString(3)) };
        cnt++;
      }
      rs.close();
      total += cnt;
      Logger.log('page ' + p + '  offset ' + offset + '  got ' + cnt + '  (total ' + total + ')');
      if (cnt < PAGE) break;
      offset += PAGE;
      Utilities.sleep(SLEEPMS);
    }
    st.close();
  } finally {
    c.close();
  }

  var out = { generated_at: new Date().toISOString(), items: items };
  var json = JSON.stringify(out);

  // Overwrite the same Drive file each run so you always grab the latest.
  var name = 'stock.json';
  var it = DriveApp.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(json);
  else DriveApp.createFile(name, json, 'application/json');

  Logger.log('stock.json written: ' + total + ' items');
  return total;
}

function toNum_(s) {
  var n = Number(s);
  return isFinite(n) ? n : 0;
}
