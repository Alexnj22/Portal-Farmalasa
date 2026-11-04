@echo off
rem Doble clic aca para instalar el agente de impresion en una caja con Windows.
rem Abre instalar.ps1, que pide permiso de administrador y hace todo lo demas.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
