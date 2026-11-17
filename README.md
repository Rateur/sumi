<div align="center">
  <img src=".github/assets/logo.svg" width="112" height="112" alt="">
  <h1>Sumi</h1>
  <p>A free, open-source island for the top of your Windows screen.</p>
  <p>
    <a href="https://github.com/Rateur/sumi/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Rateur/sumi?style=flat-square&color=0B0B0F"></a>
    <a href="https://github.com/Rateur/sumi/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Rateur/sumi/ci.yml?branch=dev&style=flat-square&label=CI"></a>
    <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square">
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/Rateur/sumi?style=flat-square&color=8B5CF6"></a>
  </p>
  <p><b>English</b> · <a href="README.fr.md">Français</a></p>
</div>

![The music panel at the top of the screen, with the time in the bubble beside it](.github/assets/hero.webp)

Sumi puts a small black pill at the top of your screen. It shows the time, then changes when something happens: a song starts, an app turns on your microphone, a timer runs out. Click it for controls.

> [!NOTE]
> Sumi is in early development. Version 0.4.0 shows the time, adds the date when you rest the cursor on it, opens into a panel when you click it, hides while a game or video is fullscreen, and shows your music with its controls. Watch the repository (Custom → Releases) to hear about new versions.

## Download

[**Download Sumi for Windows**](https://github.com/Rateur/sumi/releases/latest/download/Sumi-setup.exe) (10 and 11, 64-bit), or pick a version on the [releases page](https://github.com/Rateur/sumi/releases).

The installer isn't signed yet. Your browser may hold it as rarely downloaded: keep it from its downloads list. Windows then warns about an unknown publisher: click **More info**, then **Run anyway**. Signing is on its way: see the [code signing policy](https://rateur.github.io/sumi/docs/code-signing/). Quit Sumi from its tray icon.

## Roadmap

Each step ships as its own version. Version 1.0 is done when every box is checked.

- [x] The island at the top of the screen, with the time (0.1.0)
- [x] Spring animations: rest the cursor on the island and it widens, click it and it opens (0.2.0)
- [x] Hides itself while a game or video is fullscreen (0.3.0)
- [x] Music from any app Windows can control (Spotify, browsers, VLC…): artwork, previous, play/pause, next, progress; the time moves to a bubble beside it (0.4.0)
- [ ] An orange or green dot when an app uses your microphone or camera
- [ ] A command bar (`Ctrl+Alt+Space`) that sends your question to Claude, ChatGPT, Gemini, Perplexity or a search engine
- [ ] Timers: type `25m`
- [ ] Weather from [Open-Meteo](https://open-meteo.com), charging and low-battery alerts on laptops
- [ ] Settings, automatic updates and a signed installer

## How it's built

<p>
  <img alt="Rust" src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte_5-FF3E00?style=flat-square&logo=svelte&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white">
</p>

Sumi is a [Tauri 2](https://v2.tauri.app) app. A Rust core talks to Windows: it places the window, lets clicks through, and will read media, microphone and battery state. A [Svelte 5](https://svelte.dev) and TypeScript interface draws the island inside WebView2, the browser engine already built into Windows, so Sumi doesn't ship a browser of its own and the installer stays small.

## Privacy

Sumi collects nothing. Features that need the network will stay off until you turn them on.

## Contributing

Code lands on the `dev` branch first. Read [the contributing guide](.github/CONTRIBUTING.md) before opening a pull request, and [docs/design.md](docs/design.md) for how the island behaves. Questions and feedback are welcome in [Discussions](https://github.com/Rateur/sumi/discussions).

## License

[MIT](LICENSE).
