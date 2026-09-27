# naps-cli installer (Windows)
#
# Usage:
#   iwr -useb https://dl.naps.sh/install.ps1 | iex
#
# Environment overrides:
#   NAPS_CLI_VERSION       version to install (default: latest)
#   NAPS_CLI_INSTALL_DIR   target dir (default: $env:LOCALAPPDATA\naps-cli)
#   NAPS_CLI_BASE          download base URL (default: https://dl.naps.sh)

$ErrorActionPreference = 'Stop'

$base = if ($env:NAPS_CLI_BASE) { $env:NAPS_CLI_BASE } else { 'https://dl.naps.sh' }
$version = if ($env:NAPS_CLI_VERSION) { $env:NAPS_CLI_VERSION } else { 'latest' }
$installDir = if ($env:NAPS_CLI_INSTALL_DIR) { $env:NAPS_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'naps-cli' }

if ($version -eq 'latest') {
  $manifest = Invoke-RestMethod -Uri "$base/versions.json" -UseBasicParsing
  $version = $manifest.latest
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
  $expected = ((Get-Content $tmpSha -Raw).Trim() -split '\s+')[0].ToLower()
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
