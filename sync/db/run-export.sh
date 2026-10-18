#!/usr/bin/env bash
# Build products.json + stock.json from MySQL 4.0 (3 queries joined by product_id).
# Writes to OUT_DIR (default: this folder). Set OUT_DIR=../../data to write into the site.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f env.local ]; then set -a; . ./env.local; set +a; fi

JAR="${CONNECTOR_JAR:-lib/mysql-connector-java-5.1.49.jar}"
[ -f "$JAR" ] || { echo "connector jar not found: $JAR"; exit 1; }
[ -f InventoryExport.class ] || javac -cp "$JAR" InventoryExport.java

unset JAVA_TOOL_OPTIONS 2>/dev/null || true
exec java -cp ".:$JAR" InventoryExport
