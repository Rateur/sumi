# Releasing

For maintainers. A release goes from `dev` to `main`, then a tag on `main` builds the installer.

1. **Prepare, on a branch from `dev`.** Bump the version:

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

   Set the same version in `src-tauri/Cargo.toml`, then run `cargo update -p sumi --offline` in `src-tauri`. Add a section to `CHANGELOG.md`, written for users, not developers. Update the README if what users can do has changed. Open a pull request into `dev` titled `chore: release 0.2.0`.

2. **Ship to `main`.** Open a pull request from `dev` to `main` and merge it with **Create a merge commit**.

3. **Tag `main`.**

   ```bash
   git fetch origin
   git tag v0.2.0 origin/main
   git push origin v0.2.0
   ```

4. **Publish.** The tag starts the Release workflow. It checks that the tag matches the version, builds the installer and opens a draft release with the notes from `CHANGELOG.md`. Install the attached `Sumi-setup.exe`, then click **Publish release**.

   Each installer carries a build attestation. Anyone can check it came from this repository's workflow:

   ```bash
   gh attestation verify Sumi-setup.exe -R Rateur/sumi
   ```

Leave **Set as a pre-release** unchecked, except for test builds like `0.2.0-beta.1`: GitHub skips pre-releases when it resolves `releases/latest`, and the download links point there.

5. **Send it to the Microsoft Store.** The release also carries `Sumi_<version>.0_x64.msix`, built from the same commit. In [Partner Center](https://partner.microsoft.com/dashboard), open Sumi, start an update, drop the `.msix` into **Packages**, and submit. Microsoft certifies it, signs it and updates every Store install, usually within three business days.

   The package's identity lives in `src-tauri/store/AppxManifest.xml` and must match Partner Center's **Product identity** page. To try the package before a release, lay it out from a local build and register it (Windows **Developer Mode** must be on):

   ```powershell
   npm run tauri build
   src-tauri/store/pack.ps1 -LayoutOnly
   Add-AppxPackage -Register src-tauri\target\store\layout\AppxManifest.xml
   ```
