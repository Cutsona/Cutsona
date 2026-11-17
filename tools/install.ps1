# Downloads the latest stable Cutsona installer from GitHub and verifies it before launch.
[CmdletBinding()]
param(
    [switch]$DownloadOnly
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Cutsona requires Windows.' }

$repo = 'Cutsona/Cutsona'
$headers = @{
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}

$useGitHubCli = $false
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers -TimeoutSec 30
} catch {
    if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub could not open the latest Cutsona release. If the repository is private, install GitHub CLI, sign in with repository access, and use the authenticated command in the README."
    }
    $result = gh api "repos/$repo/releases/latest"
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not open the latest Cutsona release. Check gh auth status and repository access.' }
    $release = ($result -join "`n") | ConvertFrom-Json
    $useGitHubCli = $true
}

if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') {
    throw 'GitHub did not return a stable Cutsona version.'
}
$version = $Matches[1]
$name = "Cutsona-Setup-$version.exe"
$asset = $release.assets | Where-Object { $_.name -ceq $name -and $_.state -eq 'uploaded' } | Select-Object -First 1
if (!$asset -or $asset.digest -notmatch '^sha256:([a-f0-9]{64})$') {
    throw "The verified Windows installer for Cutsona $version is missing from the release."
}
$expectedHash = $Matches[1]

$folder = Join-Path ([IO.Path]::GetTempPath()) ("Cutsona-Install-" + [Guid]::NewGuid().ToString('N'))
$installer = Join-Path $folder $name
$keepInstaller = $false
New-Item -ItemType Directory -Path $folder | Out-Null
try {
    Write-Host "Downloading Cutsona $version for Windows..."
    if ($useGitHubCli) {
        gh release download $release.tag_name --repo $repo --pattern $name --dir $folder
        if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not download the Cutsona installer.' }
    } else {
        $uri = "https://github.com/$repo/releases/download/$($release.tag_name)/$name"
        Invoke-WebRequest -Uri $uri -UseBasicParsing -OutFile $installer -TimeoutSec 300
    }

    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash
    if ($actualHash -ne $expectedHash) { throw 'The installer checksum does not match the GitHub release.' }
    if ($DownloadOnly) { $keepInstaller = $true; Write-Output $installer; return }

    Write-Host "Opening the verified installer for Cutsona $version..."
    $setup = Start-Process -FilePath $installer -PassThru -Wait
    if ($setup.ExitCode -ne 0) { throw "The Cutsona installer exited with code $($setup.ExitCode)." }
} finally {
    if (!$keepInstaller) {
        if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $folder -ErrorAction SilentlyContinue
    }
}
