# Silent Windows print — smoke check (run on the Windows PC)

The automated test (`node --test test/windows-print.test.js`) pins only the
headless routing + error contract. Real printing must be checked on the PC
that runs the bridge, after rebuilding it.

## 1. Rebuild + restart the deployed bridge (C# exe)

```bat
cd tools\z-systems-bridge
build.bat
stop-bridge.bat
start-silent.vbs
```

## 2. Confirm the new bridge is running

```bat
curl http://127.0.0.1:18181/health
```

Expect `"version": "1.2.0"` and `"runtime": "Windows Native Service"`.
Any older version means the old exe is still running — stop it and restart.

## 3. List the Windows printers

```bat
curl http://127.0.0.1:18181/api/printer/list
```

Expect `{"success":true,"printers":[...]}` containing the printer name exactly
as Windows shows it (for example `EPSON WF-C5290BA`). Copy that exact name
into the POS setting "اسم طابعة ويندوز" in the app.

## 4. Silent print test (no dialog must appear)

```bat
curl -X POST http://127.0.0.1:18181/api/printer/print-windows ^
  -H "Content-Type: application/json" ^
  -d "{\"html\":\"<html><body><h1>test</h1><p>silent print</p></body></html>\",\"deviceName\":\"EPSON WF-C5290BA\",\"pageSize\":\"A4\"}"
```

Expect `{"success":true,"printer":"EPSON WF-C5290BA"}` and the page coming out
of the printer with NO print dialog. A wrong printer name answers 400 naming
the printer; an empty `html` answers 400.

## 5. Node/Electron bridge (parity path, not the deployed one)

- Headless Node: `POST /api/printer/print-windows` answers **501** naming the
  missing Electron capability; `GET /api/printer/list` answers with a clear
  capability error on a non-Windows host. The web app then falls back to the
  browser print dialog, so printing is never lost.
- Electron tray: the same two endpoints print through a hidden BrowserWindow.
