# naps-cli installer (Windows)
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/JustinyAhin/naps-cli/main/install.ps1 | iex
#
# Environment overrides:
#   NAPS_CLI_VERSION       version to install (default: latest)
#   NAPS_CLI_INSTALL_DIR   target dir (default: $env:LOCALAPPDATA\naps-cli)
#   NAPS_CLI_BASE          download base URL (default: https://dl.naps.sh)

$ErrorActionPreference = 'Stop'

$base = if ($env:NAPS_CLI_BASE) { $env:NAPS_CLI_BASE } else { 'https://dl.naps.sh' }
$version = if ($env:NAPS_CLI_VERSION) { $env:NAPS_CLI_VERSION } else { 'latest' }
$installDir = if ($env:NAPS_CLI_INSTALL_DIR) { $env:NAPS_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'naps-cli' }
$publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKvcoC1ojFcGh+fzVtMltG3VlFWikCW4POQin+jvuMCu'
if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
  throw 'naps-cli: OpenSSH ssh-keygen is required to verify release signatures'
}

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$allowedSigners = Join-Path $tmpDir 'allowed_signers'
[System.IO.File]::WriteAllText($allowedSigners, "naps-cli $publicKey`n", [System.Text.Encoding]::ASCII)

function Test-ReleaseSignature([string]$contentPath, [string]$signaturePath) {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'ssh-keygen'
  $start.Arguments = "-Y verify -f `"$allowedSigners`" -I naps-cli -n naps-cli-release -s `"$signaturePath`""
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($start)
  try {
    $bytes = [System.IO.File]::ReadAllBytes($contentPath)
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -eq 0) { return }
  } finally {
    $process.Dispose()
  }
  throw 'naps-cli: release signature verification failed'
}

if ($version -eq 'latest') {
  $manifestPath = Join-Path $tmpDir 'versions.json'
  $manifestSignaturePath = Join-Path $tmpDir 'versions.json.sig'
  Invoke-WebRequest -Uri "$base/versions.json" -OutFile $manifestPath -UseBasicParsing
  Invoke-WebRequest -Uri "$base/versions.json.sig" -OutFile $manifestSignaturePath -UseBasicParsing
  Test-ReleaseSignature $manifestPath $manifestSignaturePath
  $version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).latest
}
if ($version -notmatch '^v\d+\.\d+\.\d+$') {
  throw "naps-cli: invalid version: $version"
}

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "naps-cli: only Windows x64 is currently supported"
}
$target = 'windows-x64'
$binary = "naps-cli-$target.exe"
$binUrl = "$base/cli/$version/$binary"
$shaUrl = "$binUrl.sha256"

Write-Host "naps-cli: downloading $target ($version)..."
$tmpBin = New-TemporaryFile
$tmpSha = New-TemporaryFile
$tmpGz = New-TemporaryFile
try {
  Invoke-WebRequest -Uri $shaUrl -OutFile $tmpSha -UseBasicParsing
  $shaSignature = Join-Path $tmpDir 'checksum.sig'
  Invoke-WebRequest -Uri "$shaUrl.sig" -OutFile $shaSignature -UseBasicParsing
  Test-ReleaseSignature $tmpSha $shaSignature

  try {
    Invoke-WebRequest -Uri "$binUrl.gz" -OutFile $tmpGz -UseBasicParsing
    $inputStream = [System.IO.File]::OpenRead($tmpGz)
    try {
      $gzipStream = [System.IO.Compression.GzipStream]::new($inputStream, [System.IO.Compression.CompressionMode]::Decompress)
      try {
        $outputStream = [System.IO.File]::Create($tmpBin)
        try {
          $gzipStream.CopyTo($outputStream)
        } finally {
          $outputStream.Dispose()
        }
      } finally {
        $gzipStream.Dispose()
      }
    } finally {
      $inputStream.Dispose()
    }
  } catch {
    Write-Warning "naps-cli: compressed artifact unavailable or invalid; falling back to the raw binary"
    Invoke-WebRequest -Uri $binUrl -OutFile $tmpBin -UseBasicParsing
  }

  Write-Host "naps-cli: verifying checksum..."
  $checksumParts = (Get-Content $tmpSha -Raw).Trim() -split '\s+'
  if ($checksumParts.Count -ne 2 -or $checksumParts[1] -ne "cli/$version/$binary") {
    throw 'naps-cli: signed checksum does not match this release'
  }
  $expected = $checksumParts[0].ToLower()
  if ($expected -notmatch '^[0-9a-f]{64}$') { throw 'naps-cli: invalid signed checksum' }
  $actual = (Get-FileHash $tmpBin -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    throw "naps-cli: checksum mismatch (expected=$expected actual=$actual)"
  }

  if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  }
  Move-Item -Path $tmpBin -Destination (Join-Path $installDir 'naps-cli.exe') -Force
} finally {
  if (Test-Path $tmpBin) { Remove-Item $tmpBin -Force -ErrorAction SilentlyContinue }
  if (Test-Path $tmpSha) { Remove-Item $tmpSha -Force -ErrorAction SilentlyContinue }
  if (Test-Path $tmpGz) { Remove-Item $tmpGz -Force -ErrorAction SilentlyContinue }
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "naps-cli: installed to $installDir\naps-cli.exe"

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*$installDir*") {
  Write-Host ""
  Write-Host "naps-cli: $installDir is not in your PATH."
  Write-Host "          add it for the current user with:"
  Write-Host "            [Environment]::SetEnvironmentVariable('PATH', `"`$env:PATH;$installDir`", 'User')"
}

Write-Host ""
& (Join-Path $installDir 'naps-cli.exe') --version 2>$null
