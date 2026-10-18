/**
 * Inventory (คลังสินค้า) export — split into a light frequent job and a heavier
 * occasional one, and written to be MySQL 4.0 safe.
 *
 * The user's combined query uses derived tables (subquery in FROM), which are
 * 4.1+ only and run a 3-way join with two full-table GROUP BYs — heavy enough
 * to crash the shop PC. So instead we run one simple query per table and join
 * in JavaScript:
 *
 *   refreshStock()   (run often, e.g. at close): sale price + SUM(stock) only.
 *                    Never touches the big tb_recivedetail table. -> stock.json
 *   buildCatalogue() (run occasionally, after receiving stock): name + avg cost.
 *                    -> products.json
 *
 * Shares conn_() with Code.gs. Credentials in Script Properties.
 *
 * Column/table mapping (confirmed by the user):
 *   tb_product.product_id            product code
 *   tb_product.product_bname         drug name
 *   tb_product.product_sale_price    sale price
 *   tb_product.product_active        '0' = inactive
 *   tb_productall.value_now          per-lot stock; SUM per product = on hand
 *   tb_recivedetail.price_Punit      receive unit price; AVG per product = cost
 */

/** FREQUENT: price + current stock only. Light on the DB. -> stock.json in Drive. */
function refreshStock() {
  var c = conn_();
  try {
    // sale prices per active product  (single table, compact)
    var price = {};
    eachRow_(c, "SELECT product_id, product_sale_price, product_sale_price2 FROM tb_product WHERE product_active <> '0'",
      function (r) { price[r[0]] = { price: toNum_(r[1]), price2: toNum_(r[2]) }; });

    // current stock = SUM(value_now) per product  (one grouped query, ~3000 rows out)
    var onhand = {};
    eachRow_(c, "SELECT product_id, SUM(value_now) FROM tb_productall GROUP BY product_id",
      function (r) { onhand[r[0]] = toNum_(r[1]); });

    var items = {};
    Object.keys(price).forEach(function (id) {
      items[id] = { price: price[id].price, price2: price[id].price2, on_hand: onhand[id] || 0 };
    });

    var json = JSON.stringify({ generated_at: new Date().toISOString(), items: items });
    writeDrive_('stock.json', json);
    Logger.log('refreshStock: ' + Object.keys(items).length + ' products');
    return Object.keys(items).length;
  } finally {
    c.close();
  }
}

/** OCCASIONAL: catalogue + average cost. Touches tb_recivedetail. -> products.json in Drive. */
function buildCatalogue() {
  var c = conn_();
  try {
    var cat = {};
    eachRow_(c, "SELECT product_id, product_bname, product_unit_name, product_sale_price, product_sale_price2 " +
                "FROM tb_product WHERE product_active <> '0'",
      function (r) {
        cat[r[0]] = { id: r[0], name: r[1], unit: r[2], price: toNum_(r[3]), price2: toNum_(r[4]), cost: 0, active: true };
      });

    // average receive unit price per product (the one heavy table — occasional only)
    eachRow_(c, "SELECT product_id, AVG(price_Punit) FROM tb_recivedetail GROUP BY product_id",
      function (r) { if (cat[r[0]]) cat[r[0]].cost = round2_(toNum_(r[1])); });

    var products = Object.keys(cat).map(function (id) { return cat[id]; });
    products.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    writeDrive_('products.json', JSON.stringify(products));
    Logger.log('buildCatalogue: ' + products.length + ' products');
    return products.length;
  } finally {
    c.close();
  }
}

/** Trigger target: refresh stock then push to GitHub. */
function refreshStockAndPublish() {
  refreshStock();
  publishStockJson();
}

/* ---------- helpers ---------- */

function eachRow_(c, sql, fn) {
  var st = c.createStatement();
  var rs = st.executeQuery(sql);
  var n = rs.getMetaData().getColumnCount();
  while (rs.next()) {
    var row = [];
    for (var i = 1; i <= n; i++) row.push(rs.getString(i));
    fn(row);
  }
  rs.close();
  st.close();
}

function writeDrive_(name, content) {
  var it = DriveApp.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(content);
  else DriveApp.createFile(name, content, 'application/json');
}

function toNum_(s) { var n = Number(s); return isFinite(n) ? n : 0; }
function round2_(n) { return Math.round(n * 100) / 100; }
