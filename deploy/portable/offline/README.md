# Archives downloaded by hand

Drop files here when the installer cannot download them itself — an office
network that inspects HTTPS will often let **Chrome** through while Python is
refused with `CERTIFICATE_VERIFY_FAILED`.

Download these in the browser on the same machine, put them in this folder,
and run the installer again. It uses whatever it finds here instead of the
network.

| File | From |
|---|---|
| `Release-25.07.0-0.zip` (or any `Release-*.zip`) | https://github.com/oschwartz10612/poppler-windows/releases |
| `node-v24.22.1-win-x64.zip` (or any `node-v*`) | https://nodejs.org/dist/latest-v24.x/ |

The checksum check is skipped for files placed here — you fetched them
yourself, so you are vouching for them.

Everything except this README is git-ignored.
