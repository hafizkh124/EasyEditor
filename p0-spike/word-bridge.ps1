<#
  word-bridge.ps1 — M7 P0 spike: a long-lived PowerShell host that drives
  Word (and, incidentally, LibreOffice detection) over COM, receiving one
  JSON command per line on stdin and writing one JSON result per line on
  stdout. This is the exact pattern planned for electron/host/powershell.ts
  (تہہ ۱) — the spike proves the pattern works before any Electron code is
  written around it.

  Never evaluates model/user text as script — every command is a JSON
  object with a fixed "op" field; arguments are read as data, never
  interpolated into a command string. This is the same rule the real
  electron/host/ layer must follow (see plan §"سلامتی کا بنیادی اصول").

  Usage (manual):
    powershell -NoProfile -ExecutionPolicy Bypass -File word-bridge.ps1
    then paste JSON lines, e.g.:
    {"op":"ping"}
    {"op":"open","path":"C:\\Users\\you\\Desktop\\test.docx"}
    {"op":"setTrackRevisions","enabled":true}
    {"op":"setRtlPageSetup"}
    {"op":"insertFootnote","text":"یہ ایک آزمائشی حاشیہ ہے۔"}
    {"op":"save"}
    {"op":"openPdfReflow","path":"C:\\Users\\you\\Desktop\\test.pdf"}
    {"op":"wordPid"}
    {"op":"close"}
    {"op":"quit"}

  Usually driven by host.mjs instead (see run-all.mjs).
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$word = $null
$doc = $null

function Write-Result($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 6
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Ensure-Word {
    if ($null -eq $script:word) {
        $script:word = New-Object -ComObject Word.Application
        $script:word.Visible = $true
    }
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
            'open' {
                Ensure-Word
                $script:doc = $script:word.Documents.Open($cmd.path)
                Write-Result @{ ok = $true; op = 'open'; name = $script:doc.Name }
            }
            'openPdfReflow' {
                # Proves: Word's own PDF-to-editable-text reflow, no external
                # converter. This is the "PDF → ورڈ" row of the conversion map.
                Ensure-Word
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $script:doc = $script:word.Documents.Open($cmd.path)
                $sw.Stop()
                $wordCount = $script:doc.Words.Count
                Write-Result @{ ok = $true; op = 'openPdfReflow'; ms = $sw.ElapsedMilliseconds; wordCount = $wordCount }
            }
            'setTrackRevisions' {
                if ($null -eq $script:doc) { throw 'no document open' }
                $script:doc.TrackRevisions = [bool]$cmd.enabled
                Write-Result @{ ok = $true; op = 'setTrackRevisions'; enabled = $script:doc.TrackRevisions }
            }
            'setRtlPageSetup' {
                # Proves: page setup + bidi/RTL properties are reachable and
                # stick after save (tested by reopening in test-checklist).
                if ($null -eq $script:doc) { throw 'no document open' }
                $ps = $script:doc.PageSetup
                $ps.TopMargin = 72; $ps.BottomMargin = 72
                $ps.LeftMargin = 108; $ps.RightMargin = 72
                $script:doc.Content.ParagraphFormat.ReadingOrder = 1  # wdReadingOrderRtl
                Write-Result @{ ok = $true; op = 'setRtlPageSetup' }
            }
            'insertFootnote' {
                # Proves: real Word footnotes (word/footnotes.xml on disk),
                # not a fake margin note — the core of the "docx as source of
                # truth" decision.
                if ($null -eq $script:doc) { throw 'no document open' }
                $range = $script:doc.Content
                $range.Collapse(0)  # wdCollapseEnd
                # 2nd arg (custom mark) is optional — pass Missing, not a
                # blank string, or Word will use an empty mark instead of
                # falling back to its own auto-numbering.
                $script:doc.Footnotes.Add($range, [System.Type]::Missing, $cmd.text) | Out-Null
                Write-Result @{ ok = $true; op = 'insertFootnote'; footnoteCount = $script:doc.Footnotes.Count }
            }
            'installFontCheck' {
                # Proves: a font just copied into the per-user Fonts folder
                # (see font-install-test.ps1) is visible to Word WITHOUT
                # restarting this Word process.
                if ($null -eq $script:doc) { throw 'no document open' }
                $names = @()
                foreach ($f in $script:word.FontNames) { $names += $f }
                $found = $names -contains $cmd.fontName
                Write-Result @{ ok = $true; op = 'installFontCheck'; found = $found; fontCount = $names.Count }
            }
            'save' {
                if ($null -eq $script:doc) { throw 'no document open' }
                $script:doc.Save()
                Write-Result @{ ok = $true; op = 'save' }
            }
            'saveAs' {
                if ($null -eq $script:doc) { throw 'no document open' }
                # 16 = wdFormatXMLDocument (.docx)
                $script:doc.SaveAs2($cmd.path, 16)
                Write-Result @{ ok = $true; op = 'saveAs'; path = $cmd.path }
            }
            'wordPid' {
                # Proves: process.ts's orphan-cleanup logic has a real PID to
                # act on. Returns WINWORD.EXE's process id so the host
                # (host.mjs / run-all.mjs) can kill this PowerShell script
                # WITHOUT calling word.Quit() first, then separately check
                # whether WINWORD.EXE is still running a few seconds later —
                # that gap is exactly the orphan process.ts must close.
                $proc = Get-Process -Name WINWORD -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($null -eq $proc) { throw 'WINWORD.EXE not found in process list' }
                Write-Result @{ ok = $true; op = 'wordPid'; pid = $proc.Id }
            }
            'close' {
                if ($null -ne $script:doc) { $script:doc.Close($false); $script:doc = $null }
                Write-Result @{ ok = $true; op = 'close' }
            }
            'quit' {
                if ($null -ne $script:word) { $script:word.Quit(); $script:word = $null }
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
