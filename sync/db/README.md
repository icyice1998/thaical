# DbTool — read-only inspector for the legacy MySQL 4.0 database

A tiny Java tool to connect to the old SmartDrugstore MySQL 4.0 database and
dump its schema and sample rows. It uses **old Connector/J (5.1.49)**, which
still speaks MySQL 4.0's pre-4.1 "old password" handshake — modern drivers
(Python, Connector/J 8, etc.) cannot.

It is **read-only by convention**: it only runs `SHOW`, `DESCRIBE`, `SELECT`.
Always connect with a read-only database user anyway.

## Where to run it

Two options:

1. **On the shop PC (recommended).** The DB is local, so it's fast and needs no
   tunnel. Use `run.bat`. This is the normal place for it — the export job will
   live here too.
2. **From the cloud session.** Needs the DB exposed publicly (ngrok TCP) *and*
   the cloud environment's network policy to allow that host:port. Raw MySQL TCP
   often isn't allowed, so if the cloud connection is refused, fall back to
   option 1 and paste the output.

## Setup

Prerequisite: a JDK on PATH (`java` and `javac`). You already use JDBC, so Java
is installed. The connector jar is included in `lib/`.

Windows (shop PC):
```
copy env.local.bat.example env.local.bat
notepad env.local.bat        REM fill in host/port/user/pass
run.bat ping
```

Linux/macOS/cloud:
```
cp env.example env.local
nano env.local               # fill in host/port/user/pass
./run.sh ping
```

## Commands

```
run.bat ping                 connect, print server + driver version
run.bat tables               list all tables
run.bat ddl                  SHOW CREATE TABLE for every table  (full schema)
run.bat ddl tb_sale          SHOW CREATE TABLE for one table
run.bat cols tb_saledetail   column list (DESCRIBE)
run.bat count                row count for every table
run.bat peek tb_sale 20      first 20 rows of a table
run.bat sql "SELECT ..."     run a read-only query (TSV output)
```

(Use `./run.sh ...` on Linux/macOS/cloud — same commands.)

Output is tab-separated UTF-8, safe to copy and paste back into the chat.

## For the schema review we're doing now

To look at the sales tables behind the "ยอดไม่ตรง" question:

```
run.bat tables
run.bat ddl                          > schema.txt     REM full schema, then share schema.txt
run.bat count                                         REM row counts, to size each table
run.bat peek tb_sale 5
run.bat peek tb_saledetail 10
```

Then find the edit/void table (whatever its real name is) and `ddl` + `peek` it
for one bill known to have been edited.

## Exposing the DB for cloud access (only if using option 2)

On the shop PC, with ngrok installed:
```
ngrok tcp 3306
```
ngrok prints something like `tcp://0.tcp.ngrok.io:12345`. Put that host and port
in `env.local`. Create a dedicated read-only MySQL user first; do not expose the
admin account. Close the tunnel when done.

## Troubleshooting

- **Garbled Thai text** — change `DB_CHARSET` (TIS620 → latin1 → UTF-8) until
  names read correctly.
- **"Communications link failure" from the cloud** — the network policy likely
  blocks the raw TCP port. Run on the shop PC instead (option 1).
- **Auth/handshake error** — confirm the connector jar is the 5.1.x in `lib/`,
  not a modern one; modern drivers reject 4.0's old-password auth.

## Build products.json + stock.json (InventoryExport)

`InventoryExport.java` runs the three 4.0-safe queries (tb_product,
SUM tb_productall, AVG tb_recivedetail), joins them by `product_id` in a
HashMap, and writes `products.json` + `stock.json`.

```
run-export.bat                 REM writes into this folder
set OUT_DIR=..\..\data & run-export.bat   REM writes straight into the site's data/
```

(Linux/macOS: `OUT_DIR=../../data ./run-export.sh`.) Then commit the two files,
or push them with the Apps Script publisher / a git commit.
