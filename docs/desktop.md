# Use on your own computer

Invoice can serve as a personal desktop tool: run it on your computer and open
it in your browser. Your invoices and files stay local. There is no native
desktop window, installer, tray icon, or automatic background launcher; closing
the browser does not stop the app.

## Option 1: prebuilt container

This is the simplest route if you already use Docker. It requires no local
application build and the standard Compose configuration binds the published
port to loopback, so other computers cannot connect through that port by default.

Follow the [GHCR installation instructions](../README.md#install-with-docker-compose-ghcr),
keeping `INVOICE_BIND_ADDRESS=127.0.0.1`. Then open <http://localhost:3000>.
The current published image targets Linux amd64; other architectures are not
yet supported release artifacts. The pinned `0.1.2` image predates the unreleased
beta features shown in the screenshots.

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

## Option 2: compiled executable on Linux x64

The app can be compiled into a Bun executable with its runtime assets embedded.
The current build script targets **Linux x64**, not native Windows or macOS.
The release workflow currently checks compilation but does **not** attach a
standalone executable download. Until binary downloads are provided, build it
from a source checkout:

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

## Keep your data safe

For the executable example, all persistent data is under `data/desktop/`; for
the standard container it is under `data/`. Stop the app and back up the entire
appropriate directory, including the SQLite database and stored files, before
upgrading. An executable is replaceable; your data directory is not.

Use the [backup and restore guide](self-hosting.md#backups-and-restore), adapting
the paths and stop/start method to your installation. Never run a demo seed
against your working data; the [demo guide](demo.md) uses a separate database.
