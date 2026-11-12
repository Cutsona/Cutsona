# Cutsona installer for Windows 10 / 11.
# Gets Git, Node.js and FFmpeg if they're missing, downloads Cutsona, sets up the speech tools for
# smarter cuts and captions, adds Desktop and Start menu shortcuts, then opens Cutsona.
# Safe to run again: it skips whatever is already done. Works from a file (Install.cmd) or straight from the web:
#   irm https://raw.githubusercontent.com/Cutsona/Cutsona/main/install.ps1 | iex
& {
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'https://github.com/Cutsona/Cutsona.git'
$fromFile = [bool]$PSCommandPath

function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Fail($m) { throw "CUTSONA: $m" }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Winget($id, $extra = @()) { winget install -e --id $id --silent --accept-source-agreements --accept-package-agreements @extra | Out-Null; RefreshPath }
function Need($cmd, $id, $name) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Say "$name is ready" 'Green'; return }
  Say "Installing $name..."
  Winget $id
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Say "$name is ready" 'Green' }
  else { Fail "$name didn't install. Run: winget install $id   then run this installer again." }
}

try {
  Write-Host ''
  Say 'Installing Cutsona' 'Yellow'
  Write-Host ''
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail 'This PC is missing winget. Install "App Installer" from the Microsoft Store, then run this again.' }

  # 1. the tools Cutsona runs on
  Need git Git.Git 'Git'
  Need node OpenJS.NodeJS.LTS 'Node.js'
  Need ffmpeg Gyan.FFmpeg 'FFmpeg'

  # 2. Cutsona itself: this folder when the installer runs from a copy, otherwise <your user folder>\Cutsona
  $here = if ($fromFile) { Split-Path -Parent $PSCommandPath } else { '' }
  $dir = if ($env:CUTSONA_DIR) { $env:CUTSONA_DIR } elseif ($here -and (Test-Path (Join-Path $here 'server.js'))) { $here } else { Join-Path $HOME 'Cutsona' }
  if (-not (Test-Path (Join-Path $dir 'server.js'))) {
    if ((Test-Path $dir) -and (Get-ChildItem $dir -Force | Select-Object -First 1)) { Fail "$dir already exists and isn't Cutsona. Rename or move that folder, then run this again." }
    Say 'Downloading Cutsona...'
    git clone --quiet $Repo $dir
    if ($LASTEXITCODE -ne 0) { Fail "Couldn't download Cutsona. Check your internet connection, then run this again." }
  }
  Say "Cutsona is in $dir" 'Green'

  # 3. speech tools (Whisper): find sentence breaks for better cuts, and make captions. Optional.
  $cfg = Join-Path $dir 'transcription.config.json'
  if (-not $env:CUTSONA_SKIP_SPEECH -and -not (Test-Path $cfg)) {
    Say 'Setting up speech tools for captions (a few minutes the first time)...'
    $venv = Join-Path $dir 'bin\speech'; $py = Join-Path $venv 'Scripts\python.exe'
    if (-not (Test-Path $py)) {
      $base = $null
      if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.12', '3.11', '3.10') { $p = (& py "-$v" -c 'import sys; print(sys.executable)' 2>$null); if ($LASTEXITCODE -eq 0 -and $p) { $base = "$p".Trim(); break } }
      }
      $user312 = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
      if (-not $base -and (Test-Path $user312)) { $base = $user312 }
      if (-not $base) { Winget Python.Python.3.12 @('--scope', 'user'); if (Test-Path $user312) { $base = $user312 } }
      if ($base) { & $base -m venv $venv 2>&1 | Out-Null }
    }
    $ok = $false
    if (Test-Path $py) {
      & $py -m pip install --quiet --disable-pip-version-check 'faster-whisper==1.2.1' 2>&1 | Out-Null
      & $py -c 'import faster_whisper' 2>$null; $ok = ($LASTEXITCODE -eq 0)
    }
    if ($ok) { [IO.File]::WriteAllText($cfg, (@{ python = $py } | ConvertTo-Json)); Say 'Speech tools are ready' 'Green' }
    else { Say "Speech tools couldn't be set up. Cutsona still works; captions stay off. Run the installer again to retry." 'DarkYellow' }
  }

  # 4. shortcuts on the Desktop and in the Start menu
  if (-not $env:CUTSONA_NO_SHORTCUTS) {
    $sh = New-Object -ComObject WScript.Shell
    foreach ($where in 'Desktop', 'Programs') {
      $l = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath($where)) 'Cutsona.lnk'))
      $l.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'; $l.Arguments = "`"$dir\Cutsona.vbs`""
      $l.WorkingDirectory = $dir; $l.IconLocation = "$dir\Cutsona.ico,0"; $l.Description = 'Cutsona'; $l.Save()
    }
    Say 'Added Cutsona to your Desktop and Start menu' 'Green'
  }

  Write-Host ''
  Say 'Done. Opening Cutsona.' 'Yellow'
  Write-Host ''
  if (-not $env:CUTSONA_NO_LAUNCH) { Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$dir\Cutsona.vbs`"" -WorkingDirectory $dir }
}
catch {
  $m = "$($_.Exception.Message)"
  Write-Host ''
  Say ($(if ($m.StartsWith('CUTSONA: ')) { $m.Substring(9) } else { "Something went wrong: $m" })) 'Red'
  Write-Host ''
  if ($fromFile) { exit 1 }  # from the web (irm | iex), just stop: never close the person's PowerShell window
}
}
