# Audio Compressor for Tidal Luna

A [Tidal Luna](https://github.com/Inrixia/TidaLuna) plugin that runs Tidal's audio through a dynamics compressor, evening out loud and quiet parts of tracks. The defaults match the audio compressor in the FrankerFaceZ Twitch add-on.

## Features

- **Compressor** with adjustable threshold, knee, ratio, attack, release and gain.
- **Player bar button** next to Repeat to switch the compressor on and off.
- **Volume bar controls Gain** while the compressor is on (optional). The middle of the bar is 100% (no change) and the top is 200%. Your normal volume comes back when you turn the compressor off.
- Works with the [HorizontalVolumeSlider](https://github.com/Foukapik/TidaLuna-Plugins) plugin: its number box shows Gain (0–200) and accepts typed Gain values.

## How it works

Tidal desktop normally plays lossless and hi-res tracks through a native player that runs outside the app, where plugins can't reach the sound. While this plugin is enabled, Tidal uses its browser player for every quality instead, the same player the Tidal web app uses. The plugin then routes that player's audio through a Web Audio `DynamicsCompressorNode` and a gain stage.

Things to know:

- **Exclusive mode isn't available** while the browser player is in use. Disabling the plugin switches Tidal back to the native player.
- **DRM-protected streams** can't be processed by Web Audio. If Tidal sends one, the plugin leaves it alone and it plays without compression.
- If a track is playing when the plugin loads, it's reloaded on the browser player at the same position.
- The plugin finds Tidal's player internals by what the code does, not by name, but a big Tidal update could still break that. If it does, the plugin's settings page shows the error.

## Settings

Open **Luna Settings → Plugins** and expand **@luna/audio-compressor**:

| Setting | Default | What it does |
| --- | --- | --- |
| Compressor | On | Turns compression on or off (same as the player bar button). |
| Volume bar controls Gain | On | While the compressor is on, the volume bar sets Gain. |
| Gain | 100% | Volume after compression. |
| Threshold | -50 dB | Level above which compression starts. |
| Knee | 40 dB | Range over which compression fades in. |
| Ratio | 12:1 | Input dB needed for 1 dB more output. |
| Attack | 0 s | Time taken to turn the volume down by 10 dB. |
| Release | 0.25 s | Time taken to turn the volume back up by 10 dB. |

## Installing

Install from this repo's latest release by adding the store link in **Luna Settings → Plugin Store**:

```
https://github.com/StealthClobber/tidaluna-audio-compressor/releases/download/latest/store.json
```

or the plugin directly:

```
https://github.com/StealthClobber/tidaluna-audio-compressor/releases/download/latest/luna.audio-compressor
```

These links only work while the repo is public.

## Development

Requires Node.js and pnpm (`npm install -g pnpm`).

```sh
pnpm install
pnpm run watch
```

`watch` rebuilds on every change and serves the plugin at `http://localhost:3000`. Install it from the **DEV** store under **Luna Settings → Plugin Store**, and turn on live reload on its card to pick up changes automatically.

Source is in `plugins/AudioCompressor/src`:

| File | Purpose |
| --- | --- |
| `index.ts` | Startup, following the player, volume bar as Gain. |
| `player.ts` | Finds Tidal's player SDK and switches between the native and browser players. |
| `audio.ts` | Web Audio graph (compressor and gain) and the per-element volume correction. |
| `button.ts` | The player bar toggle button. |
| `volumeText.ts` | HorizontalVolumeSlider number box integration. |
| `Settings.tsx` | Settings page. |
| `defaults.ts` | Default values and slider ranges. |

Pushing to the default branch builds the plugin with GitHub Actions and publishes it to the `latest` release. That needs **Settings → Actions → General → Workflow permissions** set to **Read and write permissions**.

## License

[AGPL-3.0](LICENSE), from the [luna-template](https://github.com/Inrixia/luna-template).
