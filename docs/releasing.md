# Releasing

For maintainers. A release goes from `dev` to `main`, then a tag on `main` builds the installer.

1. **Prepare, on a branch from `dev`.** Bump the version:

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

   Set the same version in `src-tauri/Cargo.toml`, then run `cargo update -p sumi --offline` in `src-tauri`. Add a section to `CHANGELOG.md`, written for users, not developers. Then bring everything users read up to date, in English and French:

   - the README: the note on what the current version does, and the roadmap's box for this version;
   - the site: the roadmap in `site/src/i18n/home.ts`, in both languages (the line's tag, and its live preview if the feature has one), the home page if it shows the feature, and the feature's page in the docs;
   - a short GIF of the new feature in `.github/assets/`, recorded from the site's showcase island (`npm run dev` in `site/` builds it first);
   - the README's demo GIF, `.github/assets/demo.gif`, recorded again so it shows the new feature too.

   Open a pull request into `dev` titled `chore: release 0.2.0`.

2. **Ship to `main`.** Open a pull request from `dev` to `main` and merge it with **Create a merge commit**. Merging puts the site online through the Site workflow.

3. **Tag `main`.**

   ```bash
   git fetch origin
   git tag v0.2.0 origin/main
   git push origin v0.2.0
   ```

4. **Publish.** The tag starts the Release workflow. It checks that the tag matches the version, builds the installer and opens a draft release with the notes from `CHANGELOG.md`. Put the GIF at the top of the notes (`https://raw.githubusercontent.com/Rateur/sumi/v0.2.0/.github/assets/<name>.gif`) and the [code signing policy](https://sumi.rateur.fr/docs/code-signing/) link at the bottom. Install the attached `Sumi-setup.exe`, then click **Publish release** with **Set as the latest release** checked. Then check the site: its download links point to this release now.

   Each installer carries a build attestation. Anyone can check it came from this repository's workflow:

   ```bash
   gh attestation verify Sumi-setup.exe -R Rateur/sumi
   ```

Leave **Set as a pre-release** unchecked, except for test builds like `0.2.0-beta.1`: GitHub skips pre-releases when it resolves `releases/latest`, and the download links point there.
