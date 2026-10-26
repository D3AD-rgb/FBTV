#!/usr/bin/env bash
# Sets up, or updates, an always-on FBTV library server on an Ubuntu VM (tested on Ubuntu 24.04,
# ARM64 and x86-64). Safe to run again: it updates Node, the code and the services in place.
#
#   - Node.js (official build, checksum-verified) in /opt/node; git and ffmpeg (ffprobe) from apt
#   - the FBTV code in ~/fbtv (public repository), the private library in ~/FBTV-local-data
#   - an access key in ~/FBTV-local-data/settings/server-key (created once, readable only by you)
#   - fbtv-library.service: the library server on 127.0.0.1:8787, access key required
#   - fbtv-refresh.timer: library refresh every night; fbtv-validate.timer: stream checks weekly
#
# The server is only reachable from the VM itself. Publish it with Tailscale Funnel (HTTPS):
#   sudo tailscale funnel --bg --https=443 http://127.0.0.1:8787
# and give the TV https://<vm>.<tailnet>.ts.net/k/<key>/registry.json (see docs/library.md).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.22.1}"
REPO="${REPO:-https://github.com/D3AD-rgb/FBTV.git}"
APP_DIR="${APP_DIR:-$HOME/fbtv}"
DATA_DIR="${DATA_DIR:-$HOME/FBTV-local-data}"
PORT="${PORT:-8787}"
RUN_AS="$(id -un)"

case "$(uname -m)" in
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

echo "== Node.js v$NODE_VERSION"
if [ "$(/opt/node/bin/node -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  file="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  sudo rm -rf /opt/node.new
  sudo mkdir -p /opt/node.new
  sudo tar -xJf "$tmp/$file" -C /opt/node.new --strip-components=1
  sudo rm -rf /opt/node
  sudo mv /opt/node.new /opt/node
  rm -rf "$tmp"
fi
/opt/node/bin/node -v

echo "== git and ffprobe"
missing=()
command -v git >/dev/null || missing+=(git)
command -v ffprobe >/dev/null || missing+=(ffmpeg)
if [ "${#missing[@]}" -gt 0 ]; then
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}"
fi

echo "== code in $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only -q
else
  git clone -q --depth 1 "$REPO" "$APP_DIR"
fi
git -C "$APP_DIR" log --oneline -1

echo "== library in $DATA_DIR"
mkdir -p "$DATA_DIR/settings"
KEY_FILE="$DATA_DIR/settings/server-key"
if [ ! -s "$KEY_FILE" ]; then
  (umask 077 && head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$KEY_FILE")
  echo "created a new access key"
fi
chmod 600 "$KEY_FILE"

echo "== services"
ENV_LINES="Environment=IPTV_DATA_DIR=$DATA_DIR
Environment=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin"

sudo tee /etc/systemd/system/fbtv-library.service >/dev/null <<EOF
[Unit]
Description=FBTV library server (127.0.0.1:$PORT, access key required)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$APP_DIR
$ENV_LINES
ExecStart=/opt/node/bin/node src/library/main.ts serve --host 127.0.0.1 --port $PORT --key-file $KEY_FILE
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/fbtv-refresh.service >/dev/null <<EOF
[Unit]
Description=FBTV library refresh (sources, fixtures, catalogues, TV export)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_AS
WorkingDirectory=$APP_DIR
$ENV_LINES
ExecStart=/opt/node/bin/node src/library/main.ts refresh
Nice=10
TimeoutStartSec=4h
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
EOF

sudo tee /etc/systemd/system/fbtv-refresh.timer >/dev/null <<EOF
[Unit]
Description=Refresh the FBTV library every night

[Timer]
OnCalendar=*-*-* 04:30:00 Europe/London
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo tee /etc/systemd/system/fbtv-validate.service >/dev/null <<EOF
[Unit]
Description=FBTV stream checks (reachability and playback with ffprobe)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_AS
WorkingDirectory=$APP_DIR
$ENV_LINES
ExecStart=/opt/node/bin/node src/library/main.ts validate --limit 4000 --playable 300
Nice=10
TimeoutStartSec=4h
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
EOF

sudo tee /etc/systemd/system/fbtv-validate.timer >/dev/null <<EOF
[Unit]
Description=Check FBTV streams every week

[Timer]
OnCalendar=Sun *-*-* 05:30:00 Europe/London
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable -q fbtv-library.service fbtv-refresh.timer fbtv-validate.timer
sudo systemctl restart fbtv-library.service
sudo systemctl start fbtv-refresh.timer fbtv-validate.timer
sleep 2
systemctl --no-pager --lines=0 status fbtv-library.service | head -3
systemctl list-timers --no-pager 'fbtv-*' | head -4
echo "Done. Library server on 127.0.0.1:$PORT (access key in $KEY_FILE)."
