<#
  font-install-test.ps1 — M7/M8 P0 spike, proof (5): does a font installed
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
    3. Calls AddFontResourceW() and broadcasts WM_FONTCHANGE so running
       apps (Word included) refresh their font list.
    4. Prints the font's internal name so you can check for it via
       word-bridge.ps1's "installFontCheck" op WITHOUT restarting Word.

  P0 spike RESULT (2026-08-29, real Windows 11 + Word 16.0), recorded in
  ADR-0015: steps 1+2 ALONE are NOT enough — the font stayed invisible to
  a running Word *and* to a freshly-started Word (font count unchanged).
  Adding step 3 (AddFontResourceW + WM_FONTCHANGE) fixed it: a new Word saw
  the font, and an already-running Word picked it up with NO restart. So
  the real font adapter (M8 P2) must do the API registration, not just the
  file copy + registry write — and then still verify with installFontCheck,
  falling back to "restart Word" only if that verification fails.
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

# ── The step the file copy + registry write is missing ──────────────────
# AddFontResourceW registers the face with GDI for the calling session;
# the WM_FONTCHANGE broadcast tells every top-level window to rebuild its
# font list. Without this, Word does not see the font (proven in the spike).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FontApi {
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern int AddFontResourceW(string lpFileName);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam,
        uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
$faces = [FontApi]::AddFontResourceW($destPath)
$HWND_BROADCAST = [IntPtr]0xffff
$WM_FONTCHANGE  = 0x001D
$SMTO_ABORTIFHUNG = 0x0002
$result = [IntPtr]::Zero
[FontApi]::SendMessageTimeout($HWND_BROADCAST, $WM_FONTCHANGE, [IntPtr]::Zero, [IntPtr]::Zero, $SMTO_ABORTIFHUNG, 3000, [ref]$result) | Out-Null

Write-Output "Installed per-user: $fontName"
Write-Output "  file:   $destPath"
Write-Output "  regkey: $regKey"
Write-Output "  AddFontResourceW faces registered: $faces ; WM_FONTCHANGE broadcast sent"
Write-Output ""
Write-Output "Now, WITHOUT closing your already-running word-bridge.ps1 session, send:"
Write-Output "  {""op"":""installFontCheck"",""fontName"":""$fontName""}"
Write-Output "and check whether found=true."
