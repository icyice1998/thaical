# Apps Script JDBC access to drgstr

Google Apps Script runs on Google's servers, which can open a real JDBC/TCP
connection to the MySQL 4.0 database through the ngrok tunnel — something the
Claude cloud container cannot do (its egress proxy blocks raw-TCP databases).
So Apps Script is the bridge that reads the DB; the schema/data it pulls comes
back here for the web app.

Read-only by convention: the script only runs `SHOW` / `DESCRIBE` / `SELECT`.
Use a read-only database user anyway.

## Setup (once)

1. Go to https://script.google.com → **New project**.
2. Replace the default `Code.gs` with this folder's `Code.gs`.
3. **Project Settings** (gear icon) → **Script Properties** → add:

   ```
   DB_HOST   = 1.tcp.ap.ngrok.io
   DB_PORT   = 24772
   DB_NAME   = drgstr
   DB_USER   = <read-only user>
   DB_PASS   = <password>
   DB_PARAMS = useUnicode=true&characterEncoding=TIS620
   ```

   (Leave `DB_PARAMS` off at first if you like; add the charset one when Thai
   text comes back garbled.)

4. The ngrok tunnel must be up (`tcp://1.tcp.ap.ngrok.io:24772`) and the shop PC
   on while you run these.

## Run (in this order)

1. Select **testConnection** in the function dropdown → **Run**. Approve the
   authorization prompt the first time. The execution log should show
   `connected. server version = 4.0.x`.
2. Run **dumpSchema**. It writes the full schema to a new Google Doc and logs
   the Doc URL. Share that Doc (or paste its text) back into the chat.
3. Run **tableCounts**. Copy the logged `rows / table` list back.

That gives us the real table names, structures, and sizes — in particular the
sales tables (`tb_sale`, `tb_saledetail`, and whatever the edit/void table is
really called) behind the sales-total mismatch.

## Later

- `peek` — edit the `TABLE` / `N` at the top, run it, copy the TSV. Use it on a
  bill known to have been edited (header + detail + the edit table).
- `runQuery` — edit `SQL`, run it, copy the TSV. This is where the reconcile
  queries for the sales total will go once we see the schema.

## Notes

- Execution limit is 6 minutes per run — fine for schema and counts. Big data
  exports get paginated later.
- If `testConnection` fails with a handshake/auth error, note the exact message;
  it tells us whether Apps Script's driver accepts the 4.0 old-password auth on
  this server.
- Credentials stay in Script Properties, never in `Code.gs`, so this file is
  safe to keep in the repo.
