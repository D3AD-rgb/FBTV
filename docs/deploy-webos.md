# Installing FBTV on your LG TV

Uses the official LG webOS CLI (`@webos-tools/cli` 3.x, commands `ares-*`).

## 1. One-time PC setup

Node.js 24 LTS and the LG CLI. On this PC they were installed portably (no admin) in
`C:\Users\<you>\tools\node`; add that folder to your PATH, or install system-wide instead:

```bash
winget install OpenJS.NodeJS.LTS
```

```bash
npm install -g @webos-tools/cli
```

Check:

```bash
ares-package --version
```

## 2. Pair the TV (one time, and again if the TV's IP changes)

1. On the TV, open the **Developer Mode** app. Note the **IP address** and the **Passphrase**, and make sure
   **Key Server** is on. The PC and TV must be on the same network.
2. Register the TV on the PC (the default developer port is 9922 and the user is `prisoner`):

```bash
ares-setup-device -a tv -i "{'username':'prisoner','host':'192.168.1.50','port':'9922'}"
```

   Replace `192.168.1.50` with your TV's IP.
3. Fetch the TV's SSH key. You will be asked for the passphrase shown on the TV — type it yourself:

```bash
ares-novacom --device tv --getkey
```

4. Confirm the connection:

```bash
ares-device-info --device tv
```

## 3. Build, package, install, launch

```bash
npm install
```

```bash
npm run check
```

```bash
npm run package
```

```bash
npm run deploy
```

`npm run deploy` installs `releases/<app-id>_<version>_all.ipk` on the device named `tv` and launches it. Use
`npm run deploy -- --device <name>` for another registered device, `--no-launch` to only install, and
`--inspect` to open Web Inspector.

Equivalent raw commands:

```bash
ares-install --device tv releases/io.github.<you>.fbtv_0.1.0_all.ipk
```

```bash
ares-launch --device tv io.github.<you>.fbtv
```

## 4. Logs and debugging

Open Chrome DevTools for the running app (console, network, elements):

```bash
ares-inspect --device tv --app io.github.<you>.fbtv --open
```

FBTV writes console lines prefixed `[fbtv]` (start-up version, device info from Diagnostics); read them in the
inspector's Console. (`ares-log` is not available with the CLI's `tv` profile.)

## 5. Rebuild and reinstall after changes

```bash
npm run package && npm run deploy
```

Reinstalling the same app id keeps its local data (favourites, settings). To remove it:

```bash
ares-install --device tv --remove io.github.<you>.fbtv
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ares-*` not found | Add the Node folder to PATH, or set `ARES_CLI_DIR` for the npm scripts. |
| Connection refused / timeout | TV and PC on the same network; Developer Mode app open; correct IP; Key Server on; re-run `--getkey`. |
| App disappeared from the TV | The Developer Mode session expired (~50 h, FND-004). Extend it in the Developer Mode app, then `npm run deploy`. |
| `Denied method call` in the console | A Luna API needs its ACG group in `requiredACG` (`vite.config.ts`). |
| Black screen after launch | Run `ares-inspect` and check the console; the Diagnostics screen shows engine version and supported formats. |
