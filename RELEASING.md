# Releasing Cutsona

GitHub Actions builds the Windows installer when a version tag is pushed. The workflow publishes it to **GitHub Releases** with the `latest.yml` and blockmap files used by electron-updater.

## Publish a version

1. Raise `version` in `version.json` (three numbers, e.g. `1.3.0`).
2. Write that version's notes at the top of `CHANGELOG.md`: `## 1.3.0 - Short title`, then the changes.
3. Double-click `tools\Release.cmd`. It commits, tags `v1.3.0` and pushes; GitHub builds the installer and
   publishes the release (about 10 minutes, follow it under the repository's **Actions** tab).

While the repository is private, download updates from GitHub Releases while signed in with repository access. From v1.2.0 onward, the in-app updater can also access private releases when Cutsona is launched with a `GH_TOKEN` or `GITHUB_TOKEN` environment variable that has read access to the repository. Keep credentials out of source files and installers.

## Signing (so Windows doesn't warn people)

Without a code-signing certificate the installer is **unsigned**: Windows SmartScreen shows
"Windows protected your PC" and people have to click *More info → Run anyway*. Signing removes the
"unknown publisher" part; SmartScreen still learns a new certificate's reputation over the first downloads.

You need a Windows code-signing certificate in your name (or your company's), from a certificate authority
(for example Certum, which also has a lower-cost certificate for open-source projects, Sectigo, DigiCert or SSL.com),
or Microsoft's Azure Trusted Signing service. A certificate needs an identity check, so only you can get it.

Once you have it as a `.pfx` file with a password:

1. Turn the file into text: in PowerShell
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\cutsona.pfx")) | Set-Clipboard`
2. On GitHub: the repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `WIN_CSC_LINK`: paste the text from step 1
   - `WIN_CSC_KEY_PASSWORD`: the certificate's password
3. Release as usual. The workflow passes them to electron-builder, which signs the app and the installer
   (SHA-256, time-stamped). Without the secrets it keeps building unsigned installers.

Never commit the `.pfx` file or its password.

## Test builds on your PC

`npm run dist` builds `dist\Cutsona-Setup-<version>.exe` without publishing anything.
