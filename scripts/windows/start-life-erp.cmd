@echo off
rem Starts LIFE ERP in production mode. Used by the auto-start task, or double-click it.
cd /d "%~dp0..\.."
title LIFE ERP
call npm start
