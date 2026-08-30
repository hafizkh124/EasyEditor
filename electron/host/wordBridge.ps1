<#
  wordBridge.ps1 — M8 Layer 1: the long-lived PowerShell host that drives
  Microsoft Word over COM. One JSON command per line on stdin, one JSON
  result per line on stdout. This is the production form of the pattern the
  P0 spike proved (p0-spike/word-bridge.ps1 + host.mjs); it is spawned and
  managed by electron/host/powershell.ts.

  SECURITY (SPEC-M8 §3.3, same rule as electron/ipc/registry.ts): model or
  user text is NEVER evaluated as script. Every command is a JSON object
  with a fixed "op"; paths and payloads are read as data. Nothing here
  reaches Invoke-Expression, `cmd /c`, or a shell string.

  Ownership (SPEC-M8 §6 constraint 1 / P0 proof 6): Word does NOT exit when
  the process automating it dies. Ensure-Word records the PID set before it
  creates the COM object and diffs afterwards, so the host can tell the
  renderer *exactly which* WINWORD.EXE it started ("ownedByUs"). If COM
  attaches to a Word the user already had open, ownedByUs is false and
  electron/host/process.ts must never kill it.

  Protocol: every reply is a single compact JSON line. Success: {ok:true,...}.
  Failure: {ok:false, op:"<op>", error:"<message>"}. A line that is not valid
  JSON gets {ok:false, error:"bad json: ..."} and the loop continues.
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

$script:word = $null
$script:doc = $null
# PID of the WINWORD.EXE this host started, or $null if none / attached to a
# pre-existing instance.
$script:ownedWordPid = $null

function Write-Result($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 8
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Get-WinwordPids {
    @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Ensure-Word {
    if ($null -ne $script:word) { return }

    $before = Get-WinwordPids
    $script:word = New-Object -ComObject Word.Application
    # Headless: the renderer drives it, the user never sees this instance.
    $script:word.Visible = $false
    try { $script:word.DisplayAlerts = 0 } catch { }  # wdAlertsNone
    try { $script:word.Options.CheckGrammarAsYouType = $false } catch { }
    try { $script:word.Options.CheckSpellingAsYouType = $false } catch { }

    $after = Get-WinwordPids
    $new = $after | Where-Object { $_ -notin $before }
    if ($new.Count -eq 1) {
        $script:ownedWordPid = [int]$new[0]
    } elseif ($before.Count -gt 0) {
        # COM handed us a Word the user already had open. We do not own it.
        $script:ownedWordPid = $null
    } elseif ($after.Count -ge 1) {
        # Race: another WINWORD appeared too. Best effort — take the newest.
        $script:ownedWordPid = [int]($after | Sort-Object | Select-Object -Last 1)
    } else {
        $script:ownedWordPid = $null
    }
}

function Require-Doc {
    if ($null -eq $script:doc) { throw 'no document open' }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }

    try {
        $cmd = $line | ConvertFrom-Json
    } catch {
        Write-Result @{ ok = $false; error = "bad json: $($_.Exception.Message)" }
        continue
    }

    try {
        switch ($cmd.op) {
            'ping' {
                Write-Result @{ ok = $true; op = 'ping'; pong = $true }
            }

            'detectWord' {
                # One-shot capability probe. Does NOT keep Word open — creates
                # a throwaway instance, reads the version, quits it.
                $probe = $null
                try {
                    $probe = New-Object -ComObject Word.Application
                    $probe.Visible = $false
                    $version = $probe.Version
                    $build = try { $probe.Build } catch { $null }
                    Write-Result @{ ok = $true; op = 'detectWord'; installed = $true; version = $version; build = $build }
                } catch {
                    Write-Result @{ ok = $true; op = 'detectWord'; installed = $false; error = $_.Exception.Message }
                } finally {
                    if ($null -ne $probe) { try { $probe.Quit() } catch { } }
                }
            }

            'open' {
                Ensure-Word
                $script:doc = $script:word.Documents.Open($cmd.path)
                Write-Result @{ ok = $true; op = 'open'; name = $script:doc.Name }
            }

            'openPdfReflow' {
                Ensure-Word
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $script:doc = $script:word.Documents.Open($cmd.path)
                $sw.Stop()
                Write-Result @{ ok = $true; op = 'openPdfReflow'; ms = $sw.ElapsedMilliseconds; wordCount = $script:doc.Words.Count }
            }

            'setTrackRevisions' {
                Require-Doc
                $script:doc.TrackRevisions = [bool]$cmd.enabled
                Write-Result @{ ok = $true; op = 'setTrackRevisions'; enabled = $script:doc.TrackRevisions }
            }

            'setRtlPageSetup' {
                Require-Doc
                $ps = $script:doc.PageSetup
                $ps.TopMargin = 72; $ps.BottomMargin = 72
                $ps.LeftMargin = 108; $ps.RightMargin = 72
                $script:doc.Content.ParagraphFormat.ReadingOrder = 1  # wdReadingOrderRtl
                Write-Result @{ ok = $true; op = 'setRtlPageSetup' }
            }

            'insertFootnote' {
                Require-Doc
                $range = $script:doc.Content
                $range.Collapse(0)  # wdCollapseEnd
                $script:doc.Footnotes.Add($range, [System.Type]::Missing, $cmd.text) | Out-Null
                Write-Result @{ ok = $true; op = 'insertFootnote'; footnoteCount = $script:doc.Footnotes.Count }
            }

            'installFontCheck' {
                Ensure-Word
                $names = @()
                foreach ($f in $script:word.FontNames) { $names += $f }
                Write-Result @{ ok = $true; op = 'installFontCheck'; found = ($names -contains $cmd.fontName); fontCount = $names.Count }
            }

            'installFont' {
                # Per-user font install that a running Word actually picks up.
                # P0 proof 5: file copy + HKCU key ALONE is not enough — the
                # AddFontResourceW + WM_FONTCHANGE broadcast is what makes it
                # visible without a Word restart.
                Ensure-Word
                $src = $cmd.path
                if (-not (Test-Path $src)) { throw "font file not found: $src" }

                Add-Type -AssemblyName System.Drawing
                $pfc = New-Object System.Drawing.Text.PrivateFontCollection
                $pfc.AddFontFile($src)
                $fontName = $pfc.Families[0].Name

                $userFonts = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
                New-Item -ItemType Directory -Force -Path $userFonts | Out-Null
                $dest = Join-Path $userFonts (Split-Path $src -Leaf)
                Copy-Item -Path $src -Destination $dest -Force

                $regKey = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
                New-Item -ItemType Directory -Force -Path $regKey | Out-Null
                Set-ItemProperty -Path $regKey -Name "$fontName (TrueType)" -Value $dest

                if ($null -eq ('WordBridgeFontApi' -as [type])) {
                    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WordBridgeFontApi {
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern int AddFontResourceW(string lpFileName);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
                }
                $faces = [WordBridgeFontApi]::AddFontResourceW($dest)
                $res = [IntPtr]::Zero
                [WordBridgeFontApi]::SendMessageTimeout([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 3000, [ref]$res) | Out-Null

                $verified = $false
                if ($null -ne $script:word) {
                    $names = @(); foreach ($f in $script:word.FontNames) { $names += $f }
                    $verified = $names -contains $fontName
                }
                Write-Result @{ ok = $true; op = 'installFont'; fontName = $fontName; facesRegistered = $faces; verifiedInRunningWord = $verified }
            }

            'readStructure' {
                # docx -> EasyEditor doc inspection side (SPEC-M8 §4). Uses
                # Word's own cross-reference list for headings rather than
                # walking every paragraph (fast on large books).
                Require-Doc
                $headings = @()
                try {
                    foreach ($h in $script:doc.GetCrossReferenceItems(1)) {  # wdRefTypeHeading
                        $t = ("$h").Trim()
                        if ($t.Length -gt 0) { $headings += $t }
                    }
                } catch { }

                $footnotes = @()
                $i = 0
                foreach ($fn in $script:doc.Footnotes) {
                    $i++
                    $footnotes += @{ index = $i; text = ("" + $fn.Range.Text).Trim() }
                }

                $ro = 'mixed'
                try {
                    $val = $script:doc.Content.ParagraphFormat.ReadingOrder
                    if ($val -eq 1) { $ro = 'rtl' } elseif ($val -eq 0) { $ro = 'ltr' }
                } catch { }

                $words = 0
                try { $words = $script:doc.ComputeStatistics(0) } catch { $words = $script:doc.Words.Count }  # wdStatisticWords

                Write-Result @{
                    ok = $true; op = 'readStructure'
                    headings = $headings
                    footnotes = $footnotes
                    trackedChanges = $script:doc.Revisions.Count
                    wordCount = $words
                    readingOrder = $ro
                }
            }

            'save' {
                Require-Doc
                $script:doc.Save()
                Write-Result @{ ok = $true; op = 'save' }
            }

            'saveAs' {
                Require-Doc
                $script:doc.SaveAs2($cmd.path, 16)  # wdFormatXMLDocument (.docx)
                Write-Result @{ ok = $true; op = 'saveAs'; path = $cmd.path }
            }

            'exportAs' {
                # Generic export. Format constants: wdFormat* enum.
                Require-Doc
                $fmt = switch ("$($cmd.format)".ToLower()) {
                    'docx' { 16 }  # wdFormatXMLDocument
                    'pdf'  { 17 }  # wdFormatPDF
                    'rtf'  { 6 }   # wdFormatRTF
                    'html' { 8 }   # wdFormatFilteredHTML
                    'txt'  { 7 }   # wdFormatUnicodeText (UTF-16 — safe for Urdu/Arabic)
                    default { throw "unsupported export format: $($cmd.format)" }
                }
                $script:doc.SaveAs2($cmd.path, $fmt)
                Write-Result @{ ok = $true; op = 'exportAs'; path = $cmd.path; format = $cmd.format }
            }

            'wordPid' {
                if ($null -ne $script:ownedWordPid) {
                    Write-Result @{ ok = $true; op = 'wordPid'; pid = $script:ownedWordPid; ownedByUs = $true }
                } else {
                    $any = Get-WinwordPids | Select-Object -First 1
                    if ($null -eq $any) { throw 'WINWORD.EXE not found in process list' }
                    Write-Result @{ ok = $true; op = 'wordPid'; pid = [int]$any; ownedByUs = $false }
                }
            }

            'close' {
                if ($null -ne $script:doc) { $script:doc.Close($false); $script:doc = $null }
                Write-Result @{ ok = $true; op = 'close' }
            }

            'quit' {
                if ($null -ne $script:doc) { try { $script:doc.Close($false) } catch { }; $script:doc = $null }
                if ($null -ne $script:word) { try { $script:word.Quit() } catch { }; $script:word = $null }
                $script:ownedWordPid = $null
                Write-Result @{ ok = $true; op = 'quit' }
                break
            }

            default {
                Write-Result @{ ok = $false; error = "unknown op: $($cmd.op)" }
            }
        }
    } catch {
        Write-Result @{ ok = $false; op = $cmd.op; error = $_.Exception.Message }
    }
}
