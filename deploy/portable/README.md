# Self-contained install — no admin, no reboot

Clone the repo, double-click one file, done. Everything the app needs lands
**inside the project folder**:

```
.runtime/node/      a portable Node 24 - not installed, just unpacked
vendor/poppler/     the PDF rasterizer (Windows)
node_modules/       the packages
apps/web/dist/      the built page
.env                your Gemini key
```

Nothing is added to `PATH`, no installer runs, no service is registered, and
**nothing asks for a restart**. That is the whole point of this directory: the
other installer (`deploy/windows`) runs the Node MSI, which can leave `PATH`
stale until the machine is rebooted. This one cannot, because it never touches
`PATH` at all. Deleting the project folder uninstalls everything.

It is the same idea as a Python `venv`, for Node. Your Python is only used to
*run the installer* — the app itself is TypeScript on Node.

## Getting the code without git

No git on the machine? You do not need it.

1. Open <https://github.com/prayat-pu/bill-matching> in the browser, signed in.
2. Green **Code** button → **Download ZIP**.
3. Right-click the zip → **Extract All** → `C:\bill-matching`.

Updating later means downloading the zip again and extracting over the top —
keep `.env`, `.runtime\` and `vendor\`, they do not come in the zip.

## Install

**Windows:** double-click `install.cmd`.
**Linux / macOS:** `python3 deploy/portable/install.py`

Needs Python 3.9+ (you have 3.12) and an internet connection. It:

1. downloads the current Node 24 for your OS and CPU, **checks it against the
   checksum published by nodejs.org**, and unpacks it into `.runtime/node`;
2. downloads poppler into `vendor/poppler` (Windows only — on Linux it asks
   you to `sudo apt install poppler-utils`, the one piece that cannot live in
   the project folder);
3. asks for the Gemini API key once and writes `.env`;
4. runs `npm ci` and builds the page, using the portable Node.

Run it again any time: it skips whatever is already in place.

```bash
python3 deploy/portable/install.py --check   # what is missing, changes nothing
```

## Run

**Windows:** double-click `start.cmd`. It prints the addresses and opens the
browser. Keep the window open — closing it stops the app. `stop.cmd` also
stops it.

**Linux:** `./deploy/portable/start.sh`, Ctrl+C to stop.

```
  ========================================================
   READY
  ========================================================

   this computer:
     http://localhost:40000

   other computers:
     http://10.34.33.186:40000
```

## Which installer should I use?

| | Use |
|---|---|
| The machine has Docker | [`deploy/docker`](../docker/README.md) — one container, nothing else to manage |
| No Docker, and you can reboot / have admin | [`deploy/windows`](../windows/README.md) — installs Node properly, runs at logon |
| No Docker, no admin, no reboot | **this one** |

## Updating

```
git pull
python3 deploy/portable/install.py
```

Then start it again. `install.py` reuses the Node it already unpacked and only
redoes `npm ci` and the build.

## "CERTIFICATE_VERIFY_FAILED" while downloading

The office network inspects HTTPS: it re-signs every site with the company's
own root certificate. Windows and Chrome were given that root, Python was not,
so the browser works and the installer does not.

The installer already loads the **Windows certificate store**, which fixes most
machines. If it still fails, it prints the exact URL it wanted and three ways
out — in order of preference:

1. **Download the file in the browser** (it works there) and drop it in
   `deploy\portable\offline\`. Re-run the installer; it uses what it finds
   there instead of the network. See that folder's README for the two files.
2. **Point Python at the company root.** Ask IT for the `.cer`/`.pem`, then:

   ```
   set SSL_CERT_FILE=C:\path\to\company-root.pem
   py -3 deploy\portable\install.py
   ```

3. **Skip the check**, only if you accept the risk:

   ```
   py -3 deploy\portable\install.py --insecure
   ```

   Node is still verified against its published SHA-256 after downloading, so
   a corrupted or swapped archive is still caught.

If what comes back is not a zip at all — a proxy login page, say — the
installer says so and prints the size, rather than failing later with a
confusing "not in the zip".

## Things worth knowing

- **Other computers need the port open.** On Windows, once, in an
  Administrator prompt:

  ```
  netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=40000
  ```

  This is the only step that wants admin, and only if other PCs must reach it.
- **It does not start by itself.** There is no service. To have it come back
  after a reboot, put a shortcut to `start.cmd` in `shell:startup`, or use
  `deploy/windows/install-startup-shortcut.cmd`.
- **Changing the port:** `set PORT=` at the top of `start.cmd`, or
  `PORT=8080 ./deploy/portable/start.sh`.
- `.runtime/` is git-ignored, so it never ends up in a commit.
