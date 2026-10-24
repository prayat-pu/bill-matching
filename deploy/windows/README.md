# Deploying on Windows

The app runs on **one Windows 10/11 PC (64-bit)**. Everyone else — including the
Windows 7 machines — just opens it in a browser. Windows 7 cannot host it: Node
24 needs Windows 10 or newer, and so does Docker Desktop.

## What you need on the host PC

| | Note |
|---|---|
| The app folder | copy this repo to the PC, without `node_modules` |
| A Gemini API key | the installer asks for it and writes `.env` |
| Internet | for the install, and for every run (the model is Google's) |
| Administrator rights | once, for the install |

Node and poppler are downloaded by the installer — nothing to fetch by hand.

## Install

1. Copy the app folder to the PC, e.g. `C:\bill-matching` (leave out
   `node_modules` — the Windows machine downloads its own).
2. Right-click `deploy\windows\install.cmd` → **Run as administrator**.

That is the whole install. It:

- checks this is 64-bit Windows 10 or newer, and stops with a clear message if not;
- downloads and installs **Node 24** if it is missing or too old;
- downloads **poppler** and puts it in `vendor\poppler`;
- asks for the **Gemini API key** and writes `.env`;
- installs the packages and builds the page;
- opens **TCP 40000** in the firewall;
- offers to start the app.

Takes about ten minutes on a normal connection, once.

### If you would rather do it by hand

<details>
<summary>Manual install</summary>

1. Install Node 24+ (64-bit MSI) from https://nodejs.org. Do **not** tick
   "Tools for Native Modules".
2. Copy the app folder to `C:\bill-matching`.
3. Unzip https://github.com/oschwartz10612/poppler-windows/releases so this
   file exists: `C:\bill-matching\vendor\poppler\Library\bin\pdftoppm.exe`
   (older zips use `vendor\poppler\bin\pdftoppm.exe` — both work).
4. Create `C:\bill-matching\.env` with one line: `GEMINI_API_KEY=your-key`.
   In Notepad, save with the file name in quotes: `".env"`.
5. Double-click `deploy\windows\setup.cmd` — it checks all of the above, then
   installs the packages and builds the page.

</details>

## Run

Double-click `deploy\windows\start.cmd`. It prints the addresses:

```
this PC:   http://localhost:40000
other PCs: http://192.168.1.50:40000
```

Keep that window open — closing it stops the app. `stop.cmd` also stops it.

### Start it automatically

Two ways, pick one.

**Easy, no admin:** double-click `install-startup-shortcut.cmd`. It drops a
shortcut in your Startup folder, so the app starts hidden at logon. Remove it
with Win+R → `shell:startup` → delete "Bill Matching". You still need the
firewall rule once (the script prints the command).

**As a task, with the firewall rule:** right-click `install-autostart.cmd` →
**Run as administrator**. Same result, plus it opens TCP 40000. Remove it with
`schtasks /delete /tn BillMatching /f`.

Either way the app only starts once somebody logs in. If it must serve with
nobody logged on, open Task Scheduler, change the trigger to "At startup" and
tick "Run whether user is logged on or not".

## On the Windows 7 machines

Nothing to install. Open the address the host printed. Use **Chrome 109** or
**Firefox 115 ESR** — the last versions for Windows 7. The page is built for
exactly those; anything older (Internet Explorer) will not work.

## Settings

`start.cmd` sets these; edit the file to change them.

| Variable | Meaning |
|---|---|
| `PORT` | the port, default 40000 |
| `HOST` | `0.0.0.0` lets the LAN reach it; `127.0.0.1` locks it to this PC |
| `PDFTOPPM` | full path to `pdftoppm.exe` |
| `GEMINI_MODEL` | put it in `.env` to change the model |

## Things to know before you rely on it

- **No login.** Anyone who can reach the port can run a job and spend API
  credit. Keep it on the office LAN, never port-forward it to the internet.
- **Nothing is stored.** The workbook lives in memory for 30 minutes after the
  run, then it is gone. Tell people to download it.
- **Restarting loses a run in flight**, including the extraction you paid for.
- **Speed.** Rasterizing the PDF is the slow part and it uses the host's CPU.
  Roughly 5 s a page on a modern machine; an old office PC will be slower.
- **Updating.** Copy the new files over, run `setup.cmd` again, restart.

## If something goes wrong

| Message | Fix |
|---|---|
| `could not run "...pdftoppm.exe"` | the poppler path is wrong — check step 3 |
| `GOOGLE_API_KEY is not set` | `.env` is missing or sits in the wrong folder |
| other PCs cannot connect | firewall rule missing (`install-autostart.cmd` adds it), or `HOST` is `127.0.0.1` |
| `EADDRINUSE` | it is already running — use `stop.cmd` first |
| page loads but looks broken | the browser is older than Chrome 109 |
