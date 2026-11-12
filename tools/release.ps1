# Publishes a new Cutsona version: tags it and pushes, then GitHub builds the installer and publishes the release
# (.github/workflows/release.yml). Everyone with Cutsona installed gets the Update button.
# Before running: raise "version" in version.json and write that version's notes at the top of CHANGELOG.md
# ("## 1.1.0 - Short title", then the changes). Then double-click tools\Release.cmd.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Fail($msg) { Write-Host ""; Write-Host "  $msg" -ForegroundColor Red; Write-Host ""; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed. Get it from https://git-scm.com and try again.' }
if (-not (Test-Path .git)) { Fail 'This folder is not a git repository yet.' }

$version = (Get-Content version.json -Raw | ConvertFrom-Json).version
if (-not ($version -match '^\d+\.\d+\.\d+$')) { Fail "version.json has no valid version (found '$version'). Use three numbers, like 1.1.0." }
$tag = "v$version"

$log = Get-Content CHANGELOG.md -Raw -ErrorAction SilentlyContinue
if (-not ($log -match "(?m)^##\s+v?$([regex]::Escape($version))\b")) {
  Fail "CHANGELOG.md has no section for $version yet. Add one at the top:`n`n  ## $version - Short title`n  - What's new`n  - What's fixed"
}
$ErrorActionPreference = 'Continue'
git fetch --tags --quiet origin 2>$null
if (git tag -l $tag) { Fail "$tag is already published. Raise the version in version.json first (for example to the next number)." }

Write-Host ""
Write-Host "  Publishing Cutsona $version" -ForegroundColor Yellow
# the desktop app's version (package.json) follows version.json
if (Get-Command npm -ErrorAction SilentlyContinue) { npm version $version --no-git-tag-version --allow-same-version *> $null }
git add -A 2>$null
$staged = git diff --cached --name-only
if ($staged) { git commit -q -m "Cutsona $version"; Write-Host "  Saved your changes ($(@($staged).Count) files)." }
git tag -a $tag -m "Cutsona $version"
git push -q origin HEAD
if ($LASTEXITCODE -ne 0) { git tag -d $tag | Out-Null; Fail 'Pushing to GitHub failed. Check your internet connection and that you are signed in.' }
git push -q origin $tag
if ($LASTEXITCODE -ne 0) { git tag -d $tag | Out-Null; Fail 'Pushing the version tag to GitHub failed. Try again.' }

Write-Host "  Done: GitHub is building the Cutsona $version installer now (about 10 minutes)." -ForegroundColor Green
Write-Host "  Follow it at https://github.com/Cutsona/Cutsona/actions . When it's finished, everyone gets the update." -ForegroundColor Green
Write-Host ""
