# Use on your own computer

Pipa can serve as a personal desktop tool: run it on your computer and open
it in your browser. Your invoices and files stay local. There is no native
desktop window, installer, tray icon, or automatic background launcher; closing
the browser does not stop the app.

## Option 1: prebuilt container

This is the simplest route if you already use Docker. It requires no local
application build and the standard Compose configuration binds the published
port to loopback, so other computers cannot connect through that port by default.

Follow the [GHCR installation instructions](../README.md#install-with-docker-compose-ghcr),
keeping `INVOICE_BIND_ADDRESS=127.0.0.1`. Then open <http://localhost:3000>.
The published Docker image targets Linux amd64. For native ARM64 use, choose a
standalone executable below instead. The pinned image version is `0.2.0`.

Run these commands from the directory containing your Compose file:

```sh
# Start or resume the app.
docker compose -f compose.yml up -d

# Stop the app when you are finished; keep its data.
docker compose -f compose.yml stop invoice
```

Your data is in the host's `data/` directory beside the Compose file. Do not
delete it when updating the container. If you use the optional Gotenberg
override, include `-f compose.gotenberg.yml` in the same commands.

## Option 2: standalone executable

The release workflow builds the following downloads, with runtime assets and
SQLite embedded. These downloads are included starting with `v0.2.0`;
older releases do not include them.

| Your computer | Download |
| --- | --- |
| Linux x64 (glibc, e.g. Ubuntu/Debian) | `pipa-linux-x64.tar.gz` |
| Linux ARM64 (glibc) | `pipa-linux-arm64.tar.gz` |
| Windows x64 | `pipa-windows-x64.zip` |
| macOS Intel | `pipa-macos-x64.tar.gz` |
| macOS Apple Silicon | `pipa-macos-arm64.tar.gz` |

Get the matching archive and `SHA256SUMS.txt` from the
[GitHub release](https://github.com/arieltl/pipa/releases). Verify the archive's
SHA-256 against the checksum file before extracting: use `sha256sum` on Linux,
`shasum -a 256` on macOS, or `Get-FileHash -Algorithm SHA256` in PowerShell.
These are unsigned executables, not installers; Windows/macOS may display
security warnings. macOS builds are not notarized. Only run downloads you trust.

Extract into a dedicated folder. The executable is named `invoice` on Linux/macOS
and `invoice.exe` on Windows, retaining the existing executable name for compatibility.
Run `./invoice` from that folder, or `.\invoice.exe` in PowerShell, then open
<http://localhost:3000>. No Bun installation is needed to run it. By default,
data is stored in `./data` relative to your working directory. Keep launching
from the same folder, or set absolute storage paths as explained below.

To build the Linux x64 executable yourself from a source checkout:

```sh
bun install --frozen-lockfile
bun run build:binary
```

Bun is needed to build, but not to run the resulting `dist/invoice` executable.
No separate database server or Docker service is needed for the built-in PDF
renderer. HTML PDF templates still require optional Gotenberg.

### Network access matters

The executable defaults to `127.0.0.1` (loopback), so only your computer can
connect. You can set `INVOICE_HOST` or override it with `--host`; the command-line
option takes precedence. To deliberately allow connections from other computers:

```sh
./dist/invoice --host 0.0.0.0
```

Keep the same storage environment variables used for your normal launch when
adding this option. Network access still depends on your firewall and routing.
There is no built-in authentication: use this only on a trusted private network
or behind an authenticating proxy. `INVOICE_BIND_ADDRESS` is a separate Compose
setting for the published host port. See the [security boundary](self-hosting.md#security-boundary).

### Start and stop

From the checkout, run the executable with an explicit, separate data location:

```sh
DATA_DIR=./data/desktop \
DB_PATH=./data/desktop/app.db \
FILES_DIR=./data/desktop/files \
TMP_DIR=./data/desktop/tmp \
PORT=3000 ./dist/invoice
```

Open <http://localhost:3000>. Startup creates the directories and applies
database migrations. Keep the terminal open; press **Ctrl+C** there to stop the
app. If port 3000 is occupied, choose another `PORT` and use it in the browser URL.
Use `./dist/invoice --help` for listener options. Older released images/binaries
may predate the loopback default and `--host` option described here.

The paths above are relative to your working directory. If you move the binary
or create a launcher, use fixed absolute paths for all four storage variables
so you do not accidentally open a different empty database. Do not run two app
instances against the same data at once.

For downloaded archives, replace `./dist/invoice` with `./invoice`. On Windows,
set environment variables in PowerShell before starting the executable, for example:

```powershell
$env:DATA_DIR = "$env:LOCALAPPDATA\Pipa"
$env:DB_PATH = "$env:DATA_DIR\app.db"
$env:FILES_DIR = "$env:DATA_DIR\files"
$env:TMP_DIR = "$env:DATA_DIR\tmp"
$env:PORT = "3000"
.\invoice.exe
```

Keep using those same paths on subsequent launches and upgrades. Optional HTML
templates still need a separate [Gotenberg service](https://github.com/arieltl/pipa/blob/main/docs/self-hosting.md#gotenberg-html-to-pdf-rendering).
The complete online version of this guide is at
<https://github.com/arieltl/pipa/blob/main/docs/desktop.md>.

## Keep your data safe

For the executable example, all persistent data is under `data/desktop/`; for
the standard container it is under `data/`. Stop the app and back up the entire
appropriate directory, including the SQLite database and stored files, before
upgrading. An executable is replaceable; your data directory is not.

Use the [backup and restore guide](self-hosting.md#backups-and-restore), adapting
the paths and stop/start method to your installation. Never run a demo seed
against your working data; the [demo guide](demo.md) uses a separate database.
