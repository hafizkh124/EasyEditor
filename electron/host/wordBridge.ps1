<#
  wordBridge.ps1 — M8 Layer 1: the long-lived PowerShell host that drives
  Microsoft Office over COM. One JSON command per line on stdin, one JSON
  result per line on stdout. This is the production form of the pattern the
  P0 spike proved (p0-spike/word-bridge.ps1 + host.mjs); it is spawned and
  managed by electron/host/powershell.ts.

  Despite the name it now drives Word (the bulk of the ops), and — since P9 —
  Excel and PowerPoint too. Each app gets its own lazily-created COM object
  and its own before/after PID diff for ownership; `quit` closes all three.

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
$script:excel = $null
$script:wb = $null
$script:ppt = $null
$script:pres = $null
# PID of the WINWORD.EXE / EXCEL.EXE / POWERPNT.EXE this host started, or $null
# if none / attached to a pre-existing instance. process.ts only ever kills a
# PID that is still that exact process and started at the recorded time.
$script:ownedWordPid = $null
$script:ownedExcelPid = $null
$script:ownedPptPid = $null

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

function Get-ExcelPids {
    @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Get-PptPids {
    @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Resolve-OwnedPid($before, $after) {
    $new = $after | Where-Object { $_ -notin $before }
    if ($new.Count -eq 1) { return [int]$new[0] }
    if ($before.Count -gt 0) { return $null }  # attached to a pre-existing instance
    if ($after.Count -ge 1) { return [int]($after | Sort-Object | Select-Object -Last 1) }
    return $null
}

function Ensure-Excel {
    if ($null -ne $script:excel) { return }
    $before = Get-ExcelPids
    $script:excel = New-Object -ComObject Excel.Application
    $script:excel.Visible = $false
    try { $script:excel.DisplayAlerts = $false } catch { }
    try { $script:excel.ScreenUpdating = $false } catch { }
    $script:ownedExcelPid = Resolve-OwnedPid $before (Get-ExcelPids)
}

function Ensure-Ppt {
    if ($null -ne $script:ppt) { return }
    $before = Get-PptPids
    $script:ppt = New-Object -ComObject PowerPoint.Application
    # PowerPoint refuses `.Visible = $false`; presentations are opened
    # WithWindow:msoFalse instead (see the 'pptOpen' op).
    try { $script:ppt.DisplayAlerts = 1 } catch { }  # ppAlertsNone
    $script:ownedPptPid = Resolve-OwnedPid $before (Get-PptPids)
}

function Require-Wb {
    if ($null -eq $script:wb) { throw 'no workbook open' }
}

function Require-Pres {
    if ($null -eq $script:pres) { throw 'no presentation open' }
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

            'applyCitations' {
                # P6: insert real Word footnotes at each "[N]" marker. The
                # footnote TEXT is supplied by the caller from the verified
                # sources array (shared/convert/citationFootnotes.ts) — this
                # op only places what it is given, it never composes a
                # reference itself.
                Require-Doc
                $applied = 0
                $notFound = @()
                $strip = [bool]$cmd.stripMarkers
                foreach ($c in $cmd.footnotes) {
                    $marker = "" + $c.marker
                    $text = "" + $c.text
                    if ($marker -eq '' -or $text -eq '') { continue }
                    $hitAny = $false
                    $rng = $script:doc.Range(0, $script:doc.Content.End)
                    while ($true) {
                        $f = $rng.Find
                        $f.ClearFormatting()
                        $f.Text = $marker
                        $f.Forward = $true
                        $f.Wrap = 0            # wdFindStop
                        $f.MatchWildcards = $false
                        if (-not $f.Execute()) { break }
                        $hitAny = $true
                        if ($strip) {
                            $rng.Text = ''
                            $ip = $script:doc.Range($rng.Start, $rng.Start)
                        } else {
                            $ip = $script:doc.Range($rng.End, $rng.End)
                        }
                        $script:doc.Footnotes.Add($ip, [System.Type]::Missing, $text) | Out-Null
                        $applied++
                        $next = $ip.End
                        $docEnd = $script:doc.Content.End
                        if ($next -ge $docEnd) { break }
                        $rng = $script:doc.Range($next, $docEnd)
                    }
                    if (-not $hitAny) { $notFound += $marker }
                }
                Write-Result @{ ok = $true; op = 'applyCitations'; applied = $applied; notFound = $notFound; footnoteCount = $script:doc.Footnotes.Count }
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

            'installTemplate' {
                # P9 — copy a .dotx/.dotm into the per-user Templates folder so
                # Word offers it. Does not attach it to anything (see attachTemplate).
                $src = $cmd.path
                if (-not (Test-Path $src)) { throw "template file not found: $src" }
                $dir = Join-Path $env:APPDATA 'Microsoft\Templates'
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                $dest = Join-Path $dir (Split-Path $src -Leaf)
                Copy-Item -Path $src -Destination $dest -Force
                Write-Result @{ ok = $true; op = 'installTemplate'; templateName = [System.IO.Path]::GetFileNameWithoutExtension($src); dest = $dest }
            }

            'attachTemplate' {
                # P9 — attach an installed template to the open document and pull
                # its styles in. The caller runs this inside track-changes.
                Require-Doc
                $script:doc.AttachedTemplate = $cmd.path
                $script:doc.UpdateStylesOnOpen = $true
                Write-Result @{ ok = $true; op = 'attachTemplate'; path = $cmd.path }
            }

            'getGlobalOption' {
                # P9 — read one allow-listed Application.Option. The allow-list is
                # enforced here AND in electron/agent (defence in depth, §3 gate #5).
                Ensure-Word
                $o = $script:word.Options
                $val = switch ($cmd.name) {
                    'CheckSpellingAsYouType'           { $o.CheckSpellingAsYouType }
                    'CheckGrammarAsYouType'            { $o.CheckGrammarAsYouType }
                    'AutoFormatAsYouTypeReplaceQuotes' { $o.AutoFormatAsYouTypeReplaceQuotes }
                    default { throw "option not allowed: $($cmd.name)" }
                }
                Write-Result @{ ok = $true; op = 'getGlobalOption'; name = $cmd.name; value = ([string]([bool]$val)).ToLower() }
            }

            'setGlobalOption' {
                Ensure-Word
                $o = $script:word.Options
                $b = ("$($cmd.value)".ToLower() -eq 'true')
                switch ($cmd.name) {
                    'CheckSpellingAsYouType'           { $o.CheckSpellingAsYouType = $b }
                    'CheckGrammarAsYouType'            { $o.CheckGrammarAsYouType = $b }
                    'AutoFormatAsYouTypeReplaceQuotes' { $o.AutoFormatAsYouTypeReplaceQuotes = $b }
                    default { throw "option not allowed: $($cmd.name)" }
                }
                Write-Result @{ ok = $true; op = 'setGlobalOption'; name = $cmd.name; value = ([string]$b).ToLower() }
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

            # ── P9: Excel ────────────────────────────────────────────────
            'excelOpen' {
                Ensure-Excel
                $script:wb = $script:excel.Workbooks.Open($cmd.path)
                $names = @(); foreach ($ws in $script:wb.Worksheets) { $names += $ws.Name }
                Write-Result @{ ok = $true; op = 'excelOpen'; name = $script:wb.Name; sheets = $names }
            }

            'excelExport' {
                Require-Wb
                switch ("$($cmd.format)".ToLower()) {
                    'xlsx' { $script:wb.SaveAs($cmd.path, 51) }               # xlOpenXMLWorkbook
                    'csv'  { $script:wb.SaveAs($cmd.path, 62) }               # xlCSVUTF8
                    'pdf'  { $script:wb.ExportAsFixedFormat(0, $cmd.path) }   # xlTypePDF
                    default { throw "unsupported excel export format: $($cmd.format)" }
                }
                Write-Result @{ ok = $true; op = 'excelExport'; path = $cmd.path; format = $cmd.format }
            }

            'excelReadSheet' {
                Require-Wb
                $names = @(); foreach ($ws in $script:wb.Worksheets) { $names += $ws.Name }
                if ($cmd.sheet) { $ws = $script:wb.Worksheets.Item("$($cmd.sheet)") }
                else { $ws = $script:wb.ActiveSheet }
                $maxRows = if ($cmd.maxRows) { [int]$cmd.maxRows } else { 200 }
                $maxCols = if ($cmd.maxCols) { [int]$cmd.maxCols } else { 50 }
                $used = $ws.UsedRange
                $rc = [int]$used.Rows.Count
                $cc = [int]$used.Columns.Count
                $r0 = [int]$used.Row
                $c0 = [int]$used.Column
                $takeR = [Math]::Min($rc, $maxRows)
                $takeC = [Math]::Min($cc, $maxCols)
                $rows = @()
                for ($i = 0; $i -lt $takeR; $i++) {
                    $row = @()
                    for ($j = 0; $j -lt $takeC; $j++) {
                        $cell = $ws.Cells.Item($r0 + $i, $c0 + $j)
                        $row += ("" + $cell.Text)
                    }
                    $rows += , $row
                }
                Write-Result @{
                    ok = $true; op = 'excelReadSheet'
                    sheet = $ws.Name; sheets = $names
                    rows = $rows
                    truncated = (($rc -gt $takeR) -or ($cc -gt $takeC))
                }
            }

            'excelPid' {
                if ($null -ne $script:ownedExcelPid) {
                    Write-Result @{ ok = $true; op = 'excelPid'; pid = $script:ownedExcelPid; ownedByUs = $true }
                } else {
                    $any = Get-ExcelPids | Select-Object -First 1
                    if ($null -eq $any) { throw 'EXCEL.EXE not found in process list' }
                    Write-Result @{ ok = $true; op = 'excelPid'; pid = [int]$any; ownedByUs = $false }
                }
            }

            'excelClose' {
                if ($null -ne $script:wb) { $script:wb.Close($false); $script:wb = $null }
                Write-Result @{ ok = $true; op = 'excelClose' }
            }

            # ── P9: PowerPoint ──────────────────────────────────────────
            'pptOpen' {
                Ensure-Ppt
                # Open(path, ReadOnly, Untitled, WithWindow) — msoTrue=-1, msoFalse=0.
                $script:pres = $script:ppt.Presentations.Open($cmd.path, -1, 0, 0)
                Write-Result @{ ok = $true; op = 'pptOpen'; name = $script:pres.Name; slideCount = [int]$script:pres.Slides.Count }
            }

            'pptExport' {
                Require-Pres
                switch ("$($cmd.format)".ToLower()) {
                    'pptx' { $script:pres.SaveAs($cmd.path, 24) }  # ppSaveAsOpenXMLPresentation
                    'pdf'  { $script:pres.SaveAs($cmd.path, 32) }  # ppSaveAsPDF
                    default { throw "unsupported powerpoint export format: $($cmd.format)" }
                }
                Write-Result @{ ok = $true; op = 'pptExport'; path = $cmd.path; format = $cmd.format }
            }

            'pptReadOutline' {
                Require-Pres
                $slides = @()
                $n = 0
                foreach ($slide in $script:pres.Slides) {
                    $n++
                    $title = ''
                    try {
                        if ($slide.Shapes.HasTitle) { $title = ("" + $slide.Shapes.Title.TextFrame.TextRange.Text).Trim() }
                    } catch { }
                    $bullets = @()
                    foreach ($sh in $slide.Shapes) {
                        try {
                            if ($sh.HasTextFrame -and $sh.TextFrame.HasText) {
                                if ($slide.Shapes.HasTitle -and $sh.Id -eq $slide.Shapes.Title.Id) { continue }
                                foreach ($ln in ("" + $sh.TextFrame.TextRange.Text) -split "[\r\n\v]+") {
                                    $tl = $ln.Trim()
                                    if ($tl.Length -gt 0) { $bullets += $tl }
                                }
                            }
                        } catch { }
                    }
                    $slides += @{ index = $n; title = $title; bullets = $bullets }
                }
                Write-Result @{ ok = $true; op = 'pptReadOutline'; slideCount = [int]$script:pres.Slides.Count; slides = $slides }
            }

            'pptPid' {
                if ($null -ne $script:ownedPptPid) {
                    Write-Result @{ ok = $true; op = 'pptPid'; pid = $script:ownedPptPid; ownedByUs = $true }
                } else {
                    $any = Get-PptPids | Select-Object -First 1
                    if ($null -eq $any) { throw 'POWERPNT.EXE not found in process list' }
                    Write-Result @{ ok = $true; op = 'pptPid'; pid = [int]$any; ownedByUs = $false }
                }
            }

            'pptClose' {
                if ($null -ne $script:pres) { $script:pres.Close(); $script:pres = $null }
                Write-Result @{ ok = $true; op = 'pptClose' }
            }

            'close' {
                if ($null -ne $script:doc) { $script:doc.Close($false); $script:doc = $null }
                Write-Result @{ ok = $true; op = 'close' }
            }

            'quit' {
                if ($null -ne $script:doc) { try { $script:doc.Close($false) } catch { }; $script:doc = $null }
                if ($null -ne $script:word) { try { $script:word.Quit() } catch { }; $script:word = $null }
                if ($null -ne $script:wb) { try { $script:wb.Close($false) } catch { }; $script:wb = $null }
                if ($null -ne $script:excel) { try { $script:excel.Quit() } catch { }; $script:excel = $null }
                if ($null -ne $script:pres) { try { $script:pres.Close() } catch { }; $script:pres = $null }
                if ($null -ne $script:ppt) { try { $script:ppt.Quit() } catch { }; $script:ppt = $null }
                $script:ownedWordPid = $null
                $script:ownedExcelPid = $null
                $script:ownedPptPid = $null
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
