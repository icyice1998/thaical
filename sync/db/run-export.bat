@echo off
REM Build products.json + stock.json from MySQL 4.0 (3 queries joined by product_id).
REM Writes to OUT_DIR (default: this folder). Set OUT_DIR=..\..\data to write into the site.
setlocal
cd /d "%~dp0"

if exist env.local.bat call env.local.bat

if "%CONNECTOR_JAR%"=="" set CONNECTOR_JAR=lib\mysql-connector-java-5.1.49.jar
if not exist "%CONNECTOR_JAR%" ( echo connector jar not found: %CONNECTOR_JAR% & exit /b 1 )
if not exist InventoryExport.class javac -cp "%CONNECTOR_JAR%" InventoryExport.java

java -cp ".;%CONNECTOR_JAR%" InventoryExport
endlocal
