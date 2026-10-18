@echo off
REM Run DbTool on the shop PC (Windows). Needs a JDK (javac + java) on PATH.
REM Usage: run.bat ping ^| tables ^| ddl [table] ^| cols ^<t^> ^| count [t] ^| peek ^<t^> [n] ^| sql "<SELECT ...>"
setlocal
cd /d "%~dp0"

REM Load local credentials if present (not committed). Copy env.local.bat.example -> env.local.bat
if exist env.local.bat call env.local.bat

if "%CONNECTOR_JAR%"=="" set CONNECTOR_JAR=lib\mysql-connector-java-5.1.49.jar
if not exist "%CONNECTOR_JAR%" (
  echo connector jar not found: %CONNECTOR_JAR%
  exit /b 1
)
if not exist DbTool.class javac -cp "%CONNECTOR_JAR%" DbTool.java

java -cp ".;%CONNECTOR_JAR%" DbTool %*
endlocal
