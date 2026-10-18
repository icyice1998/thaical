#!/usr/bin/env bash
# Run DbTool on Linux/macOS (or in the cloud container).
# Usage: ./run.sh ping | tables | ddl [table] | cols <t> | count [t] | peek <t> [n] | sql "<SELECT ...>"
set -euo pipefail
cd "$(dirname "$0")"

# Load local credentials if present (not committed). See env.example.
if [ -f env.local ]; then set -a; . ./env.local; set +a; fi

JAR="${CONNECTOR_JAR:-lib/mysql-connector-java-5.1.49.jar}"
[ -f "$JAR" ] || { echo "connector jar not found: $JAR (set CONNECTOR_JAR or run fetch-connector.sh)"; exit 1; }
[ -f DbTool.class ] || javac -cp "$JAR" DbTool.java

# The JVM proxy banner is only needed for HTTPS; JDBC uses a raw socket, so drop it for clean output.
unset JAVA_TOOL_OPTIONS 2>/dev/null || true
exec java -cp ".:$JAR" DbTool "$@"
