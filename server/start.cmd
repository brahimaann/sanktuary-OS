@echo off
rem Started by the "Sanktuary OS server" scheduled task. Logs go to data\server.log.
cd /d "%~dp0.."
node --env-file=.env server\index.mjs >> data\server.log 2>&1
