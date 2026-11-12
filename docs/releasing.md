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

Leave **Set as a pre-release** unchecked, except for test builds like `0.2.0-beta.1`: GitHub skips pre-releases when it resolves `releases/latest`, and the download links point there.
