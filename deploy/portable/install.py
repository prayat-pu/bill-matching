#!/usr/bin/env python3
"""Install the app into this folder, touching nothing else on the machine.

Like a Python venv, but for Node: a portable Node runtime is unpacked into
.runtime/, poppler into vendor/, and that is the whole installation. Nothing
goes on PATH, nothing needs administrator rights, and nothing needs a reboot.
Delete the project folder and the machine is as it was.

    python install.py            install or repair
    python install.py --check    say what is missing, change nothing

Python 3.9+, standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import ssl
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".runtime"
NODE_HOME = RUNTIME / "node"
POPPLER_HOME = ROOT / "vendor" / "poppler"
ENV_FILE = ROOT / ".env"

# Used when nodejs.org cannot be asked which version is current.
NODE_FALLBACK = "24.22.1"
NODE_MAJOR = "24"
POPPLER_FALLBACK = "25.07.0-0"
POPPLER_URL = (
    "https://github.com/oschwartz10612/poppler-windows/releases/download"
    "/v{v}/Release-{v}.zip"
)

IS_WINDOWS = os.name == "nt"

# Set by --insecure. Last resort for a network that re-signs HTTPS with a root
# this Python will not trust even from the Windows store.
SKIP_TLS_VERIFY = False
# Where to look for archives downloaded by hand on another machine.
OFFLINE_DIR = Path(__file__).resolve().parent / "offline"


def say(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def ok(text: str) -> None:
    print(f"  {text}", flush=True)


class Failed(Exception):
    """Something the user has to fix. Printed plainly, no traceback."""


class _SkipChecksum(Exception):
    """Not an error: the archive came from offline/, so there is nothing to check."""


# --------------------------------------------------------------------------
# downloading


def tls_context() -> ssl.SSLContext:
    """Trust what Windows trusts.

    An office proxy that inspects HTTPS re-signs every certificate with the
    company's own root. Windows and Chrome have that root; Python's default
    context may not, which is exactly the
    "[SSL: CERTIFICATE_VERIFY_FAILED]" people hit while the browser works.
    So load the machine's own trust store as well.
    """
    if SKIP_TLS_VERIFY:
        context = ssl._create_unverified_context()  # noqa: SLF001 - deliberate, --insecure only
        return context

    context = ssl.create_default_context()
    if hasattr(ssl, "enum_certificates"):  # Windows only
        for store in ("ROOT", "CA"):
            try:
                for cert, encoding, trust in ssl.enum_certificates(store):
                    if encoding == "x509_asn" and (trust is True or trust):
                        try:
                            context.load_verify_locations(cadata=cert)
                        except ssl.SSLError:
                            continue  # one unusable certificate is not fatal
            except Exception:  # noqa: BLE001 - the store is a nice-to-have
                pass
    return context


def open_url(url: str, headers: dict[str, str] | None = None, timeout: int = 120):
    request = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(request, timeout=timeout, context=tls_context())


def offline_copy(patterns: list[str]) -> Path | None:
    """An archive the user downloaded by hand and dropped in offline/."""
    if not OFFLINE_DIR.is_dir():
        return None
    for pattern in patterns:
        for candidate in sorted(OFFLINE_DIR.glob(pattern)):
            if candidate.is_file():
                return candidate
    return None


def download(url: str, target: Path, label: str) -> None:
    ok(f"downloading {label} ...")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open_url(url) as response, target.open("wb") as out:
            shutil.copyfileobj(response, out)
    except (urllib.error.URLError, TimeoutError, ssl.SSLError) as cause:
        reason = getattr(cause, "reason", cause)
        hint = ""
        if "CERTIFICATE_VERIFY_FAILED" in str(reason):
            hint = (
                "\n  This network inspects HTTPS and Python does not trust its root"
                "\n  certificate. Either:"
                "\n    1. download the file yourself in the browser (it works there):"
                f"\n         {url}"
                f"\n       and put it in {OFFLINE_DIR}"
                "\n    2. or ask IT for the company root .cer and set"
                "\n         set SSL_CERT_FILE=C:\\path\\to\\company-root.pem"
                "\n    3. or, only if you accept the risk, run with --insecure"
            )
        raise Failed(f"could not download {label}\n  from {url}\n  because: {reason}{hint}") from cause


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# --------------------------------------------------------------------------
# node


def node_archive_name(version: str) -> str:
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    if IS_WINDOWS:
        return f"node-v{version}-win-{arch}.zip"
    if sys.platform == "darwin":
        return f"node-v{version}-darwin-{arch}.tar.gz"
    return f"node-v{version}-linux-{arch}.tar.xz"


def latest_node() -> str:
    try:
        with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=30) as response:
            releases = json.load(response)
        for release in releases:
            if release["version"].startswith(f"v{NODE_MAJOR}."):
                return release["version"].lstrip("v")
    except Exception:  # noqa: BLE001 - any failure here just means "use the pin"
        ok(f"nodejs.org did not answer; using the pinned {NODE_FALLBACK}")
    return NODE_FALLBACK


def node_binary() -> Path:
    return NODE_HOME / ("node.exe" if IS_WINDOWS else "bin/node")


def installed_node_version() -> str | None:
    binary = node_binary()
    if not binary.exists():
        return None
    try:
        out = subprocess.run([str(binary), "-v"], capture_output=True, text=True, timeout=30, check=True)
        return out.stdout.strip().lstrip("v")
    except Exception:  # noqa: BLE001
        return None


def install_node() -> None:
    current = installed_node_version()
    if current and current.split(".")[0] == NODE_MAJOR:
        ok(f"Node {current} is already here, in .runtime/node")
        return

    version = latest_node()
    name = node_archive_name(version)
    base = f"https://nodejs.org/dist/v{version}/"

    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        archive = temp / name

        local = offline_copy([f"node-v*-{'win' if IS_WINDOWS else 'linux'}-*", "node-v*"])
        if local is not None:
            ok(f"using {local.name} from offline/")
            shutil.copy2(local, archive := temp / local.name)
            name = local.name
        else:
            download(base + name, archive, f"Node {version} ({name})")

        # The archive is executed, so check it against the published checksum.
        sums = temp / "SHASUMS256.txt"
        try:
            if local is not None:
                ok("offline archive: checksum check skipped, you fetched it yourself")
                raise _SkipChecksum
            download(base + "SHASUMS256.txt", sums, "checksums")
            expected = next(
                (line.split()[0] for line in sums.read_text().splitlines() if line.endswith(f"  {name}")),
                None,
            )
            if expected is None:
                ok("the checksum file does not list this archive; skipping the check")
            elif sha256(archive) != expected:
                raise Failed("the downloaded Node archive does not match its published checksum")
            else:
                ok("checksum OK")
        except (Failed, _SkipChecksum):
            if sys.exc_info()[0] is Failed:
                raise
        except Exception:  # noqa: BLE001
            ok("could not fetch the checksums; continuing without the check")

        ok("unpacking ...")
        unpacked = temp / "unpacked"
        unpacked.mkdir()
        if name.endswith(".zip"):
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(unpacked)
        else:
            mode = "r:xz" if name.endswith(".xz") else "r:gz"
            with tarfile.open(archive, mode) as bundle:
                try:
                    bundle.extractall(unpacked, filter="data")
                except TypeError:  # the filter argument arrived in Python 3.12
                    bundle.extractall(unpacked)

        inner = next(path for path in unpacked.iterdir() if path.is_dir())
        if NODE_HOME.exists():
            shutil.rmtree(NODE_HOME)
        NODE_HOME.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(inner), str(NODE_HOME))

    found = installed_node_version()
    if not found:
        raise Failed("Node was unpacked but will not run. Delete .runtime and try again.")
    ok(f"Node {found} installed in .runtime/node (nothing was added to PATH)")


# --------------------------------------------------------------------------
# poppler


def poppler_binary() -> Path | None:
    names = ["Library/bin/pdftoppm.exe", "bin/pdftoppm.exe"] if IS_WINDOWS else ["bin/pdftoppm"]
    for name in names:
        candidate = POPPLER_HOME / name
        if candidate.exists():
            return candidate
    return None


def install_poppler() -> None:
    found = poppler_binary()
    if found:
        ok(f"poppler is already here: {found.relative_to(ROOT)}")
        return

    if not IS_WINDOWS:
        if shutil.which("pdftoppm"):
            ok("poppler is on the system (pdftoppm found)")
            return
        raise Failed(
            "pdftoppm is missing. On Debian or Ubuntu:\n"
            "    sudo apt install poppler-utils\n"
            "  It is the one piece this installer cannot put in the project folder on Linux."
        )

    local = offline_copy(["Release-*.zip", "poppler*.zip"])

    url = POPPLER_URL.format(v=POPPLER_FALLBACK)
    if local is None:
        try:
            with open_url(
                "https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest",
                headers={"User-Agent": "bill-matching-installer"},
                timeout=30,
            ) as response:
                assets = json.load(response).get("assets", [])
            for asset in assets:
                if asset["name"].startswith("Release-") and asset["name"].endswith(".zip"):
                    url = asset["browser_download_url"]
                    break
        except Exception as cause:  # noqa: BLE001
            ok(f"GitHub's API did not answer ({cause}); using the pinned build {POPPLER_FALLBACK}")

    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        archive = temp / "poppler.zip"
        if local is not None:
            ok(f"using {local.name} from offline/")
            shutil.copy2(local, archive)
        else:
            download(url, archive, "poppler")
        if zipfile.is_zipfile(archive) is False:
            raise Failed(
                f"what came back from {url} is not a zip ({archive.stat().st_size} bytes)."
                "\n  A proxy login page, most likely. Download it in the browser and put it in"
                f"\n  {OFFLINE_DIR}"
            )
        unpacked = temp / "unpacked"
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(unpacked)

        binary = next(unpacked.rglob("pdftoppm.exe"), None)
        if binary is None:
            raise Failed("pdftoppm.exe was not in the poppler zip")
        # .../<release>/Library/bin/pdftoppm.exe -> keep <release>
        root = binary.parent
        if root.name == "bin":
            root = root.parent if root.parent.name == "Library" else root
            root = root.parent if root.name == "Library" else root

        if POPPLER_HOME.exists():
            shutil.rmtree(POPPLER_HOME)
        POPPLER_HOME.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(root), str(POPPLER_HOME))

    found = poppler_binary()
    if not found:
        raise Failed("poppler unpacked, but pdftoppm.exe is not where it was expected")
    ok(f"poppler installed: {found.relative_to(ROOT)}")


# --------------------------------------------------------------------------
# the key, and the build


def ensure_env(check_only: bool) -> None:
    if ENV_FILE.exists() and "GEMINI_API_KEY=" in ENV_FILE.read_text(encoding="utf-8"):
        key = ""
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip()
        if key:
            ok(".env has the key")
            return
    if check_only:
        raise Failed(".env is missing its GEMINI_API_KEY")

    print("  .env is missing. Paste the Gemini API key (it is stored only in .env):")
    key = input("  GEMINI_API_KEY: ").strip()
    if not key:
        raise Failed("no key given. Put GEMINI_API_KEY=... in .env and run this again.")
    # No BOM: Node's env file reader would take it as part of the first name.
    ENV_FILE.write_text(f"GEMINI_API_KEY={key}\n", encoding="utf-8")
    ok(f"wrote {ENV_FILE.name}")


def npm_cli() -> Path:
    """Where npm sits inside the archive - Windows and Unix differ."""
    for relative in ("node_modules/npm/bin/npm-cli.js", "lib/node_modules/npm/bin/npm-cli.js"):
        candidate = NODE_HOME / relative
        if candidate.exists():
            return candidate
    raise Failed("the portable Node has no npm. Delete .runtime and run this again.")


def npm(args: list[str]) -> None:
    """Run npm from the portable Node, not from anything on PATH."""
    cli = npm_cli()

    env = dict(os.environ)
    bin_dir = NODE_HOME if IS_WINDOWS else NODE_HOME / "bin"
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    result = subprocess.run([str(node_binary()), str(cli), *args], cwd=ROOT, env=env)
    if result.returncode != 0:
        raise Failed(f"`npm {' '.join(args)}` failed. The message above says why.")


def main() -> int:
    global SKIP_TLS_VERIFY, OFFLINE_DIR  # noqa: PLW0603 - set once, from the command line

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report what is missing, change nothing")
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="skip HTTPS certificate checks (last resort on a network that re-signs HTTPS)",
    )
    parser.add_argument(
        "--offline-dir",
        type=Path,
        help=f"folder holding archives downloaded by hand (default {OFFLINE_DIR})",
    )
    args = parser.parse_args()

    SKIP_TLS_VERIFY = args.insecure
    if args.offline_dir:
        OFFLINE_DIR = args.offline_dir.resolve()
    if SKIP_TLS_VERIFY:
        print("  WARNING: --insecure, certificates are not being checked")

    print("Bill Matching - self-contained install")
    print(f"project: {ROOT}")

    try:
        if args.check:
            say("checking")
            node = installed_node_version()
            ok(f"Node: {node or 'MISSING'}")
            found = poppler_binary() or (shutil.which("pdftoppm") if not IS_WINDOWS else None)
            ok(f"poppler: {found or 'MISSING'}")
            ok(f"node_modules: {'yes' if (ROOT / 'node_modules').exists() else 'MISSING'}")
            ok(f"built page: {'yes' if (ROOT / 'apps/web/dist/index.html').exists() else 'MISSING'}")
            ensure_env(check_only=True)
            return 0

        say("Node (portable, into .runtime/node)")
        install_node()

        say("poppler (reads the receipt PDFs)")
        install_poppler()

        say("the Gemini API key")
        ensure_env(check_only=False)

        say("packages (a few minutes, needs internet)")
        npm(["ci"])

        say("building the page")
        npm(["run", "build"])

    except Failed as problem:
        print(f"\n  NOT FINISHED\n  {problem}\n")
        return 1
    except KeyboardInterrupt:
        print("\n  stopped.\n")
        return 1

    starter = "deploy\\portable\\start.cmd" if IS_WINDOWS else "./deploy/portable/start.sh"
    print(
        "\n  ========================================================\n"
        "   DONE - nothing was installed outside this folder\n"
        "  ========================================================\n"
        f"\n   start the app:  {starter}\n"
        "   uninstall:      delete the project folder\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
