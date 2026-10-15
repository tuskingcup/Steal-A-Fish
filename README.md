# Steal A Fish

เกมตกปลาสำหรับไลฟ์ TikTok คนดูส่งของขวัญ กดไลค์ หรือคอมเมนต์ เพื่อเหวี่ยงเบ็ด ตกปลาหนักเป็นล้านล้านกิโล และขโมยปลากันเอง

A desktop game for TikTok Live streamers. Viewers' gifts, likes and comments drive an HD-2D fishing game.

## For streamers

1. Download the installer for your OS from [Releases](https://github.com/tuskingcup/Steal-A-Fish/releases).
2. Open the app. Two windows appear: **Game** and **Settings**.
3. In OBS, add a **Window Capture** of the Game window (portrait 9:16).
4. In Settings, enter your TikTok username and connect. Use the simulator buttons to test rules without going live.
5. Edit gift → event rules in Settings, or edit `rules.json` in the app data folder directly; changes reload automatically.

The builds are not code-signed yet:

- **Windows**: SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
- **macOS**: right-click the app → **Open**, or allow it in **System Settings → Privacy & Security**.

TikTok events come from the unofficial `tiktok-live-connector` library, which can break when TikTok changes its systems and may need a sign-server API key.

## For developers

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev        # run the app with hot reload
pnpm test
pnpm typecheck
```

### Packaging

Installers land in `apps/desktop/release/<version>/`.

| Command | Output | Build on |
|---|---|---|
| `pnpm --filter @saf/desktop dist:mac` | `Steal A Fish-<version>-mac-universal.dmg` | macOS |
| `pnpm --filter @saf/desktop dist:win` | `…-win-x64-setup.exe` (installer), `…-win-x64-portable.exe`, `…-win-x64.zip` | Windows, or macOS/Linux with [Wine](https://www.winehq.org/) |
| `pnpm --filter @saf/desktop dist:win-zip` | `…-win-x64.zip` (unzip and run `Steal A Fish.exe`) | anywhere, no Wine needed |

Pushing a `v*` tag builds the Windows and macOS installers on GitHub Actions and attaches them to a draft release; running the **Release** workflow by hand (Actions → Release → Run workflow) builds them from any branch as downloadable artifacts.

Project context, architecture and conventions are in [CLAUDE.md](CLAUDE.md).

Points and fish have no real-world value and cannot be exchanged or traded.
