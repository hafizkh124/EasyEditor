<#
  font-install-test.ps1 — M7 P0 spike, proof (5): does a font installed
  per-user (no admin prompt) actually show up in Word's font list?

  We deliberately do NOT bundle or download any font here — Jameel Noori
  Nastaleeq and most Nastaliq fonts are third-party licensed files, not
  ours to redistribute. Point this script at a font file YOU already have
  a license for.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File font-install-test.ps1 -FontPath "C:\path\to\Jameel Noori Nastaleeq.ttf"

  What it does:
    1. Copies the font file into the CURRENT USER's font folder
       (%LOCALAPPDATA%\Microsoft\Windows\Fonts) — no admin rights needed.
    2. Registers it in HKCU (per-user registry), not HKLM — so no elevation.
    3. Prints the font's internal name so you can check for it via
       word-bridge.ps1's "installFontCheck" op WITHOUT restarting Word.

  Pass criteria (see README.md §5): the font shows up in a WORD PROCESS
  THAT WAS ALREADY RUNNING before this script ran. If it only appears
  after restarting Word, that's a real constraint the plan's "فونٹ کی
  تصدیق" risk item (#4) needs to reflect, not a pass.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$FontPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $FontPath)) {
    Write-Error "Font file not found: $FontPath"
    exit 1
}

Add-Type -AssemblyName System.Drawing
$collection = New-Object System.Drawing.Text.PrivateFontCollection
$collection.AddFontFile($FontPath)
$fontName = $collection.Families[0].Name

$userFontsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
New-Item -ItemType Directory -Force -Path $userFontsDir | Out-Null

$destPath = Join-Path $userFontsDir (Split-Path $FontPath -Leaf)
Copy-Item -Path $FontPath -Destination $destPath -Force

$regKey = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
New-Item -ItemType Directory -Force -Path $regKey | Out-Null
Set-ItemProperty -Path $regKey -Name "$fontName (TrueType)" -Value $destPath

Write-Output "Installed per-user: $fontName"
Write-Output "  file:  $destPath"
Write-Output "  regkey: $regKey"
Write-Output ""
Write-Output "Now, WITHOUT closing your already-running word-bridge.ps1 session, send:"
Write-Output "  {""op"":""installFontCheck"",""fontName"":""$fontName""}"
Write-Output "and check whether found=true."
