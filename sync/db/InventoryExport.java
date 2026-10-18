import java.sql.*;
import java.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/*
 * InventoryExport — build products.json + stock.json from the legacy MySQL 4.0
 * database using three simple, 4.0-safe queries joined by product_id in code.
 *
 * No subqueries, no temp tables, no schema changes. The three queries each hit
 * one table, so they run on MySQL 4.0 and stay light on the shop PC.
 *
 * Connection comes from the same env vars as DbTool (DB_HOST, DB_PORT, DB_NAME,
 * DB_USER, DB_PASS, DB_CHARSET, DB_PARAMS). Output dir from OUT_DIR (default ".").
 *
 * Run (after compiling with the connector on the classpath):
 *   OUT_DIR=../../data ./run-export.sh        (Linux/macOS)
 *   set OUT_DIR=..\..\data & run-export.bat    (Windows)
 */
public class InventoryExport {

    static final String Q_PRODUCT =
        "SELECT product_id, product_bname, product_unit_name, " +
        "       product_sale_price, product_sale_price2 " +
        "FROM tb_product WHERE product_active <> '0' ORDER BY product_bname";

    static final String Q_STOCK =
        "SELECT product_id, SUM(value_now) AS stock_now FROM tb_productall GROUP BY product_id";

    static final String Q_COST =
        "SELECT product_id, AVG(price_Punit) AS avg_cost FROM tb_recivedetail GROUP BY product_id";

    public static void main(String[] args) throws Exception {
        String host = env("DB_HOST", null, true);
        String port = env("DB_PORT", "3306", false);
        String name = env("DB_NAME", null, true);
        String user = env("DB_USER", null, true);
        String pass = env("DB_PASS", "", false);
        String cs   = env("DB_CHARSET", "TIS620", false);
        String extra= env("DB_PARAMS", "", false);
        String outDir = env("OUT_DIR", ".", false);

        String url = "jdbc:mysql://" + host + ":" + port + "/" + name
                + "?useSSL=false&connectTimeout=8000&socketTimeout=60000"
                + "&characterEncoding=" + cs
                + "&useOldUTF8Behavior=true&useOldAliasMetadataBehavior=true"
                + (extra.isEmpty() ? "" : "&" + extra);

        Class.forName("com.mysql.jdbc.Driver");
        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement st = c.createStatement()) {

            // stock_now per product
            Map<String, Double> stockMap = new HashMap<>();
            try (ResultSet rs = st.executeQuery(Q_STOCK)) {
                while (rs.next()) stockMap.put(rs.getString("product_id"), rs.getDouble("stock_now"));
            }
            System.out.println("stock rows   : " + stockMap.size());

            // avg_cost per product
            Map<String, Double> costMap = new HashMap<>();
            try (ResultSet rs = st.executeQuery(Q_COST)) {
                while (rs.next()) costMap.put(rs.getString("product_id"), rs.getDouble("avg_cost"));
            }
            System.out.println("cost rows    : " + costMap.size());

            // catalogue, joined with the two maps
            List<Map<String, Object>> products = new ArrayList<>();
            StringBuilder stockItems = new StringBuilder();
            int n = 0;
            try (ResultSet rs = st.executeQuery(Q_PRODUCT)) {
                while (rs.next()) {
                    String id = rs.getString("product_id");
                    String drug = rs.getString("product_bname");
                    String unit = rs.getString("product_unit_name");
                    double price = rs.getDouble("product_sale_price");
                    double price2 = rs.getDouble("product_sale_price2");
                    double stock = stockMap.getOrDefault(id, 0.0);
                    double avgCost = costMap.getOrDefault(id, 0.0);

                    Map<String, Object> p = new LinkedHashMap<>();
                    p.put("id", id);
                    p.put("name", drug);
                    p.put("unit", unit);
                    p.put("price", round2(price));
                    p.put("price2", round2(price2));
                    p.put("cost", round2(avgCost));
                    p.put("on_hand", trim(stock));
                    p.put("active", true);
                    products.add(p);

                    if (n > 0) stockItems.append(",\n");
                    stockItems.append("    ").append(jsonStr(id)).append(": {")
                        .append("\"price\": ").append(num(round2(price)))
                        .append(", \"price2\": ").append(num(round2(price2)))
                        .append(", \"on_hand\": ").append(num(trim(stock)))
                        .append("}");
                    n++;
                }
            }
            System.out.println("product rows : " + products.size());

            String now = java.time.OffsetDateTime.now().toString();
            writeFile(outDir, "products.json", productsJson(products));
            writeFile(outDir, "stock.json",
                "{\n  \"generated_at\": " + jsonStr(now) + ",\n  \"items\": {\n"
                + stockItems + "\n  }\n}\n");
            System.out.println("wrote products.json + stock.json to " + new File(outDir).getAbsolutePath());
        }
    }

    static String productsJson(List<Map<String, Object>> products) {
        StringBuilder sb = new StringBuilder("[\n");
        for (int i = 0; i < products.size(); i++) {
            Map<String, Object> p = products.get(i);
            sb.append("  {");
            int j = 0;
            for (Map.Entry<String, Object> e : p.entrySet()) {
                if (j++ > 0) sb.append(", ");
                sb.append(jsonStr(e.getKey())).append(": ").append(jsonVal(e.getValue()));
            }
            sb.append("}").append(i < products.size() - 1 ? ",\n" : "\n");
        }
        return sb.append("]\n").toString();
    }

    static String jsonVal(Object v) {
        if (v instanceof Boolean) return v.toString();
        if (v instanceof Number) return num(v);
        return jsonStr(v == null ? "" : v.toString());
    }
    static String num(Object v) {
        double d = ((Number) v).doubleValue();
        if (d == Math.floor(d) && !Double.isInfinite(d)) return Long.toString((long) d);
        return Double.toString(d);
    }
    static String jsonStr(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch)); else b.append(ch);
            }
        }
        return b.append("\"").toString();
    }

    static double round2(double d) { return Math.round(d * 100.0) / 100.0; }
    static double trim(double d) { return Math.round(d * 1000.0) / 1000.0; }

    static void writeFile(String dir, String name, String content) throws IOException {
        Path p = Paths.get(dir, name);
        Files.write(p, content.getBytes(StandardCharsets.UTF_8));
    }

    static String env(String k, String def, boolean required) {
        String v = System.getenv(k);
        if (v == null || v.isEmpty()) {
            if (required) { System.err.println("missing required env: " + k); System.exit(2); }
            return def;
        }
        return v;
    }
}
