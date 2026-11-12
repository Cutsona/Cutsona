# One-time setup: signs you in to GitHub, creates the private repo Cutsona/Cutsona, uploads Cutsona
# and publishes version 1.0.0. Safe to run again: it skips whatever is already done.
# Your API keys (config.json), transcription.config.json, cutsona-settings.json, cache, exports,
# bin and cutsona.log are never uploaded (see .gitignore).
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Repo = (Get-Content version.json -Raw | ConvertFrom-Json).repo   # like Cutsona/Cutsona
if (-not ($Repo -match '^[\w.-]+/[\w.-]+$')) { Write-Host "  version.json needs a repo, like Cutsona/Cutsona." -ForegroundColor Red; exit 1 }
$Org = $Repo.Split('/')[0]

function Fail($msg) { Write-Host ""; Write-Host "  $msg" -ForegroundColor Red; Write-Host ""; exit 1 }
function Step($msg) { Write-Host "  $msg" -ForegroundColor Yellow }

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh -and (Test-Path "$env:ProgramFiles\GitHub CLI\gh.exe")) { $gh = "$env:ProgramFiles\GitHub CLI\gh.exe" }
if (-not $gh) { Fail 'GitHub CLI is not installed. Run: winget install GitHub.cli   then try again.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed. Run: winget install Git.Git   then try again.' }
if (-not (Test-Path .git)) { git init -q -b main }

Write-Host ""
# 1. sign in (a browser page asks for a one-time code; also allow access to your organization if asked)
& $gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  Step 'Signing in to GitHub. Copy the code below, press Enter, and paste it in the browser.'
  & $gh auth login --hostname github.com --git-protocol https --web --scopes 'repo,read:org,workflow'
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub sign-in did not finish. Run this again.' }
}
& $gh auth setup-git --hostname github.com | Out-Null

# 2. who commits: your GitHub name and its private no-reply address (your real email is never used)
if (-not (git config user.name)) {
  $login = (& $gh api user --jq .login).Trim(); $id = (& $gh api user --jq .id).Trim()
  if (-not $login) { Fail 'Could not read your GitHub account. Run this again.' }
  git config user.name $login
  git config user.email "$id+$login@users.noreply.github.com"
}

# 3. save the files (the first time)
$version = (Get-Content version.json -Raw | ConvertFrom-Json).version
git rev-parse --verify -q HEAD *> $null
if ($LASTEXITCODE -ne 0) {
  Step 'Saving Cutsona'
  git add -A 2>$null
  foreach ($f in 'config.json', 'transcription.config.json', 'cutsona-settings.json', 'cutsona.log', 'slax-settings.json', 'slax.log') {
    if (git diff --cached --name-only -- $f) { Fail "$f was about to be uploaded. Stopped; nothing was sent." }
  }
  git commit -q -m "Cutsona $version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  if ($LASTEXITCODE -ne 0) { Fail 'Saving the files failed.' }
}

# 4. the private repo
& $gh repo view $Repo --json name *> $null
if ($LASTEXITCODE -ne 0) {
  Step "Creating the private repo $Repo"
  & $gh repo create $Repo --private --description 'Cutsona - auto edit maker (invite only)' --disable-wiki | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Could not create $Repo. Check that you own the $Org organization and allowed access to it when signing in." }
}
$url = "https://github.com/$Repo.git"
if (git remote get-url origin 2>$null) { git remote set-url origin $url } else { git remote add origin $url }

# 5. upload, then publish this version
Step 'Uploading Cutsona'
git push -q -u origin HEAD:main
if ($LASTEXITCODE -ne 0) { Fail 'Uploading failed. Check your internet connection and run this again.' }
$tag = "v$version"
if (-not (git ls-remote --tags origin "refs/tags/$tag")) {
  Step "Publishing Cutsona $version"
  if (-not (git tag -l $tag)) { git tag -a $tag -m "Cutsona $version" }
  git push -q origin $tag
  if ($LASTEXITCODE -ne 0) { Fail 'Publishing the version failed. Run this again.' }
  $log = Get-Content CHANGELOG.md -Raw
  $esc = [regex]::Escape($version)
  $notes = ([regex]::Match($log, "(?ms)^##\s+v?$esc\b[^\n]*\n(.*?)(?=^##\s[^#]|\z)")).Groups[1].Value.Trim()
  $title = ([regex]::Match($log, "(?m)^##\s+v?$esc\b\s*[-:]?\s*(.*)$")).Groups[1].Value.Trim()
  $nf = New-TemporaryFile; Set-Content -Path $nf -Value $notes -Encoding utf8
  & $gh release create $tag --repo $Repo --title ("$tag" + $(if ($title) { " - $title" } else { '' })) --notes-file $nf | Out-Null
  Remove-Item $nf
}

Write-Host ""
Write-Host "  Done. Cutsona $version is up at https://github.com/$Repo (private)." -ForegroundColor Green
Write-Host "  Invite people: https://github.com/orgs/$Org/people  (give them the Read role on Cutsona)"
Write-Host "  Publish updates later with tools\Release.cmd."
Write-Host ""
Start-Process "https://github.com/$Repo"
