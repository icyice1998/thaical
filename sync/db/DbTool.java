import java.sql.*;
import java.util.*;

/*
 * DbTool — minimal read-only inspector for the legacy MySQL 4.0 database.
 *
 * Connects with old Connector/J (5.1.x) which still speaks the pre-4.1
 * "old password" handshake. Reads connection settings from environment
 * variables so no credentials live in the source:
 *
 *   DB_HOST     host or ngrok TCP host           (required)
 *   DB_PORT     port                             (default 3306)
 *   DB_NAME     database/schema name             (required)
 *   DB_USER     user (use a READ-ONLY account)   (required)
 *   DB_PASS     password                         (default empty)
 *   DB_CHARSET  JDBC characterEncoding           (default TIS620 — Thai 4.0 data)
 *   DB_PARAMS   extra JDBC params appended raw   (optional)
 *
 * Commands:
 *   ping                 connect and print server version
 *   tables               list tables (SHOW TABLES)
 *   ddl [table]          SHOW CREATE TABLE (all tables if none given)
 *   cols <table>         column list (DESCRIBE)
 *   count [table]        row count (all tables if none given)
 *   peek <table> [n]     SELECT * FROM table LIMIT n   (default 20)
 *   sql "<SELECT ...>"   run a read-only query, TSV output
 *
 * Output is TSV, UTF-8, safe to copy and paste back.
 */
public class DbTool {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) { System.err.println("usage: DbTool <ping|tables|ddl|cols|count|peek|sql> [args]"); System.exit(2); }

        String host = env("DB_HOST", null, true);
        String port = env("DB_PORT", "3306", false);
        String name = env("DB_NAME", null, true);
        String user = env("DB_USER", null, true);
        String pass = env("DB_PASS", "", false);
        String cs   = env("DB_CHARSET", "TIS620", false);
        String extra= env("DB_PARAMS", "", false);

        String url = "jdbc:mysql://" + host + ":" + port + "/" + name
                + "?useSSL=false&connectTimeout=8000&socketTimeout=30000"
                + "&characterEncoding=" + cs
                + "&useOldUTF8Behavior=true&useOldAliasMetadataBehavior=true"
                + (extra.isEmpty() ? "" : "&" + extra);

        Class.forName("com.mysql.jdbc.Driver");
        try (Connection c = DriverManager.getConnection(url, user, pass)) {
            String cmd = args[0];
            switch (cmd) {
                case "ping":   ping(c); break;
                case "tables": for (String t : tables(c)) System.out.println(t); break;
                case "ddl":    ddl(c, args.length > 1 ? List.of(args[1]) : tables(c)); break;
                case "cols":   require(args, 2, "cols <table>"); cols(c, args[1]); break;
                case "count":  count(c, args.length > 1 ? List.of(args[1]) : tables(c)); break;
                case "peek":   require(args, 2, "peek <table> [n]");
                               peek(c, args[1], args.length > 2 ? Integer.parseInt(args[2]) : 20); break;
                case "sql":    require(args, 2, "sql \"<query>\""); tsv(c, args[1]); break;
                default: System.err.println("unknown command: " + cmd); System.exit(2);
            }
        }
    }

    static void ping(Connection c) throws SQLException {
        DatabaseMetaData m = c.getMetaData();
        System.out.println("connected");
        System.out.println("server   : " + m.getDatabaseProductVersion());
        System.out.println("driver   : " + m.getDriverVersion());
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT VERSION()")) {
            if (r.next()) System.out.println("version()" + ": " + r.getString(1));
        }
    }

    static List<String> tables(Connection c) throws SQLException {
        List<String> out = new ArrayList<>();
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SHOW TABLES")) {
            while (r.next()) out.add(r.getString(1));
        }
        return out;
    }

    static void ddl(Connection c, List<String> ts) throws SQLException {
        for (String t : ts) {
            System.out.println("-- ============ " + t + " ============");
            try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SHOW CREATE TABLE `" + t + "`")) {
                if (r.next()) System.out.println(r.getString(2) + ";");
            } catch (SQLException e) { System.out.println("-- error: " + e.getMessage()); }
            System.out.println();
        }
    }

    static void cols(Connection c, String t) throws SQLException {
        System.out.println("field\ttype\tnull\tkey\tdefault\textra");
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("DESCRIBE `" + t + "`")) {
            while (r.next())
                System.out.println(nz(r, "Field") + "\t" + nz(r, "Type") + "\t" + nz(r, "Null")
                        + "\t" + nz(r, "Key") + "\t" + nz(r, "Default") + "\t" + nz(r, "Extra"));
        }
    }

    static void count(Connection c, List<String> ts) throws SQLException {
        System.out.println("rows\ttable");
        for (String t : ts) {
            try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT COUNT(*) FROM `" + t + "`")) {
                if (r.next()) System.out.println(r.getLong(1) + "\t" + t);
            } catch (SQLException e) { System.out.println("?\t" + t + "\t-- " + e.getMessage()); }
        }
    }

    static void peek(Connection c, String t, int n) throws SQLException {
        tsv(c, "SELECT * FROM `" + t + "` LIMIT " + n);
    }

    static void tsv(Connection c, String q) throws SQLException {
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery(q)) {
            ResultSetMetaData m = r.getMetaData();
            int n = m.getColumnCount();
            StringBuilder h = new StringBuilder();
            for (int i = 1; i <= n; i++) h.append(i > 1 ? "\t" : "").append(m.getColumnLabel(i));
            System.out.println(h);
            while (r.next()) {
                StringBuilder row = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    String v = r.getString(i);
                    if (v == null) v = "\\N";
                    v = v.replace("\t", " ").replace("\n", " ").replace("\r", " ");
                    row.append(i > 1 ? "\t" : "").append(v);
                }
                System.out.println(row);
            }
        }
    }

    static String nz(ResultSet r, String col) throws SQLException {
        String v = r.getString(col);
        return v == null ? "" : v;
    }

    static String env(String k, String def, boolean required) {
        String v = System.getenv(k);
        if (v == null || v.isEmpty()) {
            if (required) { System.err.println("missing required env: " + k); System.exit(2); }
            return def;
        }
        return v;
    }

    static void require(String[] args, int n, String usage) {
        if (args.length < n) { System.err.println("usage: " + usage); System.exit(2); }
    }
}
