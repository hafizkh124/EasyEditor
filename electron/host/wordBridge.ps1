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

param([string]$RecordPath)

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

# Proactive orphan-cleanup side channel (SPEC-M8 §6 constraint 1): the normal
# "ownedByUs" PID only reaches electron/host/process.ts lazily, after this
# process replies to a wordPid/excelPid/pptPid request — which never happens
# if the very op that opened the app then hangs (e.g. a stuck modal). Writing
# the PID here, straight to the same doc-bridge-host.json electron/host/process.ts
# already reads on startup, means a hang has something to clean up even if no
# reply ever comes back. Best-effort: never throws, never blocks an op.
function Write-OwnedRecord($name, $procId) {
    if ([string]::IsNullOrEmpty($RecordPath) -or $null -eq $procId) { return }
    try {
        $startTime = (Get-Process -Id $procId -ErrorAction Stop).StartTime.ToString('o')
        $owned = @()
        if (Test-Path $RecordPath) {
            try {
                $parsed = Get-Content -Raw -Path $RecordPath | ConvertFrom-Json
                if ($parsed.owned) { $owned = @($parsed.owned | Where-Object { $_.name -ne $name }) }
            } catch { $owned = @() }
        }
        $owned += @{ name = $name; pid = $procId; startTime = $startTime; recordedAt = (Get-Date).ToString('o') }
        (@{ owned = $owned } | ConvertTo-Json -Depth 8) | Set-Content -Path $RecordPath -Encoding UTF8
    } catch { }
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
    Write-OwnedRecord 'WINWORD' $script:ownedWordPid
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
    Write-OwnedRecord 'EXCEL' $script:ownedExcelPid
}

function Ensure-Ppt {
    if ($null -ne $script:ppt) { return }
    $before = Get-PptPids
    $script:ppt = New-Object -ComObject PowerPoint.Application
    # PowerPoint refuses `.Visible = $false`; presentations are opened
    # WithWindow:msoFalse instead (see the 'pptOpen' op).
    try { $script:ppt.DisplayAlerts = 1 } catch { }  # ppAlertsNone
    $script:ownedPptPid = Resolve-OwnedPid $before (Get-PptPids)
    Write-OwnedRecord 'POWERPNT' $script:ownedPptPid
}

function Require-Wb {
    if ($null -eq $script:wb) { throw 'no workbook open' }
}

function Require-Pres {
    if ($null -eq $script:pres) { throw 'no presentation open' }
}

# `#RRGGBB` / `#RGB` -> Excel/Office OLE colour Long (BGR-ordered). Avoids
# System.Drawing, which is a separate package on .NET Core / pwsh.
function ConvertTo-OleColor([string]$hex) {
    if (-not $hex) { return $null }
    $h = $hex.TrimStart('#')
    if ($h.Length -eq 3) { $h = "$($h[0])$($h[0])$($h[1])$($h[1])$($h[2])$($h[2])" }
    if ($h.Length -ne 6) { throw "bad colour: $hex" }
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    return ($b -shl 16) -bor ($g -shl 8) -bor $r
}

# M12 Phase D — pick a real installed font rather than silently handing Excel
# a name nothing on the machine renders. System.Drawing is already an accepted
# dependency here (installFont/installFontCheck use it); Excel itself never
# errors on an unknown Font.Name (it just substitutes for display), so a
# lookup failure degrades to "hand the name through as-is", never a throw.
function Resolve-FontName([string]$preferred, [string]$fallback) {
    if (-not $preferred) { return $null }
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $installed = @((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name })
        if ($installed -contains $preferred) { return $preferred }
        if ($fallback -and ($installed -contains $fallback)) { return $fallback }
        return $preferred
    } catch {
        return $preferred
    }
}

# M12 Phase D — the shared body behind excelAddSheet / excelWriteRange /
# excelSetFormula / excelFormat. Both the direct ops below AND excelBatch
# (which runs several of these against the SAME already-open workbook, no
# per-sub-command save) call this, so the two paths cannot drift apart.
function Invoke-ExcelSubCommand($sub) {
    switch ($sub.op) {
        'excelAddSheet' {
            Require-Wb
            $last = $script:wb.Worksheets.Item($script:wb.Worksheets.Count)
            $newWs = $script:wb.Worksheets.Add([System.Type]::Missing, $last)
            if ($sub.name) { $newWs.Name = "$($sub.name)" }
            $names = @(); foreach ($ws in $script:wb.Worksheets) { $names += $ws.Name }
            return @{ ok = $true; op = 'excelAddSheet'; sheet = $newWs.Name; sheets = $names }
        }

        'excelRenameSheet' {
            Require-Wb
            if ($sub.sheet) { $ws = $script:wb.Worksheets.Item("$($sub.sheet)") } else { $ws = $script:wb.ActiveSheet }
            $ws.Name = "$($sub.name)"
            return @{ ok = $true; op = 'excelRenameSheet'; sheet = $ws.Name }
        }

        'excelWriteRange' {
            Require-Wb
            if ($sub.sheet) { $ws = $script:wb.Worksheets.Item("$($sub.sheet)") } else { $ws = $script:wb.ActiveSheet }
            $startCell = if ($sub.startCell) { "$($sub.startCell)" } else { "A1" }
            $data = $sub.data  # expected: 2D array (array of arrays)
            if ($data -and $data.Count -gt 0) {
                $rows = $data.Count
                $cols = if ($data[0] -is [array]) { $data[0].Count } else { 1 }
                $range = $ws.Range($startCell).Resize($rows, $cols)
                # Build a COM-safe 2D array
                $arr = New-Object 'object[,]' $rows, $cols
                for ($r = 0; $r -lt $rows; $r++) {
                    $rowData = $data[$r]
                    if ($rowData -is [array]) {
                        for ($c = 0; $c -lt $cols; $c++) {
                            $arr[$r, $c] = if ($c -lt $rowData.Count) { $rowData[$c] } else { $null }
                        }
                    } else {
                        $arr[$r, 0] = $rowData
                    }
                }
                $range.Value2 = $arr
            }
            return @{ ok = $true; op = 'excelWriteRange'; sheet = $ws.Name; startCell = $startCell }
        }

        'excelSetFormula' {
            Require-Wb
            if ($sub.sheet) { $ws = $script:wb.Worksheets.Item("$($sub.sheet)") } else { $ws = $script:wb.ActiveSheet }
            # A1 notation (`cell: "B9"`) is preferred — the natural way to
            # write "=SUM(B2:B8)" style formulas; row/col ints still work.
            if ($sub.cell) { $cellObj = $ws.Range("$($sub.cell)") }
            else { $cellObj = $ws.Cells.Item([int]$sub.row, [int]$sub.col) }
            $cellObj.Formula = "$($sub.formula)"
            return @{ ok = $true; op = 'excelSetFormula'; sheet = $ws.Name; cell = "$($cellObj.Address($false, $false))" }
        }

        'excelFormat' {
            Require-Wb
            if ($sub.sheet) { $ws = $script:wb.Worksheets.Item("$($sub.sheet)") } else { $ws = $script:wb.ActiveSheet }
            $range = $ws.Range("$($sub.range)")
            if ($null -ne $sub.bold) { $range.Font.Bold = [bool]$sub.bold }
            if ($null -ne $sub.fontSize) { $range.Font.Size = [double]$sub.fontSize }
            if ($sub.fontColor) { $range.Font.Color = ConvertTo-OleColor $sub.fontColor }
            if ($sub.fontName) {
                $resolved = Resolve-FontName "$($sub.fontName)" 'Amiri'
                if ($resolved) { $range.Font.Name = $resolved }
            }
            if ($sub.numberFormat) { $range.NumberFormat = "$($sub.numberFormat)" }
            if ($null -ne $sub.horizontalAlign) {
                # 1=left, 2=center, 3=right (xlHAlign)
                $range.HorizontalAlignment = [int]$sub.horizontalAlign
            }
            if ($null -ne $sub.autoFit) {
                if ([bool]$sub.autoFit) { $range.Columns.AutoFit() | Out-Null }
            }
            if ($sub.bgColor) {
                $range.Interior.Color = ConvertTo-OleColor $sub.bgColor
            }
            # M12 Phase D — RTL: sheet-level reading direction + this range's
            # own ReadingOrder (XlReadingOrder: xlRTL=-5004, xlLTR=-5001).
            if ($null -ne $sub.rtl) {
                $ws.DisplayRightToLeft = [bool]$sub.rtl
                $range.ReadingOrder = if ([bool]$sub.rtl) { -5004 } else { -5001 }
            }
            return @{ ok = $true; op = 'excelFormat'; sheet = $ws.Name; range = "$($sub.range)" }
        }

        default { throw "unsupported excel sub-op: '$($sub.op)'" }
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
                # WdReadingOrder: wdReadingOrderRtl = 0, wdReadingOrderLtr = 1. Until 2026-09-29
                # this set 1 (= LTR) under an 'RTL' comment, and readStructure mapped 1 -> 'rtl',
                # so the bug hid itself. Verified live: 0 writes <w:bidi/> into the paragraph
                # properties of the saved .docx, 1 does not.
                $script:doc.Content.ParagraphFormat.ReadingOrder = 0  # wdReadingOrderRtl
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
                    # wdReadingOrderRtl = 0, wdReadingOrderLtr = 1 (a mixed document
                    # returns wdUndefined and stays 'mixed').
                    if ($val -eq 0) { $ro = 'rtl' } elseif ($val -eq 1) { $ro = 'ltr' }
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

            'compareInto' {
                # P9 (agent run_task) — turn a wholesale text rewrite into real
                # tracked changes: diff the OPEN document against a revised copy
                # and save the comparison result (which carries the revisions).
                # $script:doc is the ORIGINAL; the caller closes it afterwards
                # without saving.
                Require-Doc
                $script:doc.Compare($cmd.revisedPath, 'EasyEditor Agent', 2, $true, $true) | Out-Null  # wdCompareTargetNew
                $result = $script:word.ActiveDocument
                $rev = $result.Revisions.Count
                $result.SaveAs2($cmd.outPath, 16)  # wdFormatXMLDocument
                $result.Close($false)
                Write-Result @{ ok = $true; op = 'compareInto'; revisions = $rev; outPath = $cmd.outPath }
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

            # ── M11 Phase 4: Excel write operations (ADR-0048) ──────────
            'excelCreate' {
                Ensure-Excel
                $script:wb = $script:excel.Workbooks.Add()
                # Track the PID of the Excel instance we own
                try { $script:ownedExcelPid = [int]$script:excel.Hwnd } catch { }
                # M12 Phase D — a new workbook's default sheet count depends on
                # the user's own Excel setting (SheetsInNewWorkbook), not
                # something this script controls. Normalise to exactly one so
                # excelBatch's "first sheet renames it, every other is added"
                # convention never leaves unwanted blank extra sheets behind.
                # DisplayAlerts is already off (Ensure-Excel), so no prompt.
                while ($script:wb.Worksheets.Count -gt 1) {
                    $script:wb.Worksheets.Item($script:wb.Worksheets.Count).Delete()
                }
                $names = @(); foreach ($ws in $script:wb.Worksheets) { $names += $ws.Name }
                Write-Result @{ ok = $true; op = 'excelCreate'; name = $script:wb.Name; sheets = $names }
            }

            # M12 Phase D — excelAddSheet is new; the other three now delegate
            # to Invoke-ExcelSubCommand (shared with excelBatch below) instead
            # of carrying their own copy of this logic.
            'excelAddSheet' { Write-Result (Invoke-ExcelSubCommand $cmd) }
            'excelWriteRange' { Write-Result (Invoke-ExcelSubCommand $cmd) }
            'excelSetFormula' { Write-Result (Invoke-ExcelSubCommand $cmd) }
            'excelFormat' { Write-Result (Invoke-ExcelSubCommand $cmd) }

            # M12 Phase D — run several add-sheet/write/formula/format
            # sub-commands against the ALREADY-OPEN workbook in one message,
            # so a multi-sheet build is one open -> [batch] -> export -> close
            # cycle instead of N full open/SaveAs/close COM sessions (the
            # original `build_spreadsheet` shape, which was also silently
            # broken for any sheet beyond the workbook's own default one — a
            # second sheet name that did not already exist made
            # `Worksheets.Item(name)` throw).
            'excelBatch' {
                Require-Wb
                $subCommands = @($cmd.commands)
                $results = @()
                for ($i = 0; $i -lt $subCommands.Count; $i++) {
                    $sub = $subCommands[$i]
                    try {
                        $results += (Invoke-ExcelSubCommand $sub)
                    } catch {
                        throw "excelBatch: sub-command #$($i + 1) ('$($sub.op)') failed: $($_.Exception.Message)"
                    }
                }
                Write-Result @{ ok = $true; op = 'excelBatch'; count = $results.Count; results = $results }
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

            # ── M9 Phase 2: chapters, comments, revisions, print layout, indexes ──
            'createDocument' {
                # New chapter file. With a source (an HTML fragment the adapter
                # wrote to a temp file) the content is imported; otherwise a blank
                # document. Optional RTL page setup. Saved as .docx at $cmd.path.
                Ensure-Word
                if ($cmd.sourcePath) {
                    $script:doc = $script:word.Documents.Open($cmd.sourcePath)
                } else {
                    $script:doc = $script:word.Documents.Add()
                }
                if ([bool]$cmd.rtl) {
                    $ps = $script:doc.PageSetup
                    $ps.TopMargin = 72; $ps.BottomMargin = 72; $ps.LeftMargin = 108; $ps.RightMargin = 72
                    $script:doc.Content.ParagraphFormat.ReadingOrder = 0  # wdReadingOrderRtl (see setRtlPageSetup)
                }
                $script:doc.SaveAs2($cmd.path, 16)  # wdFormatXMLDocument
                Write-Result @{ ok = $true; op = 'createDocument'; name = $script:doc.Name }
            }

            'addComment' {
                # Find the anchor text and attach a margin comment to it. The
                # caller runs this inside track-changes. Not found → reported.
                Require-Doc
                $rng = $script:doc.Range(0, $script:doc.Content.End)
                $f = $rng.Find
                $f.ClearFormatting()
                $f.Text = "" + $cmd.anchorText
                $f.Forward = $true
                $f.Wrap = 0            # wdFindStop
                $f.MatchWildcards = $false
                if ($f.Execute()) {
                    $c = $script:doc.Comments.Add($rng, "" + $cmd.text)
                    if ($cmd.author) { try { $c.Author = "" + $cmd.author } catch { } }
                    Write-Result @{ ok = $true; op = 'addComment'; added = $true; commentCount = $script:doc.Comments.Count }
                } else {
                    Write-Result @{ ok = $true; op = 'addComment'; added = $false; notFound = $true }
                }
            }

            'readRevisions' {
                # Every tracked revision as data, for building an apparatus
                # criticus from a two-witness Compare (compare_manuscript_variants).
                Require-Doc
                $revs = @()
                $docEnd = $script:doc.Content.End
                foreach ($r in $script:doc.Revisions) {
                    $t = switch ([int]$r.Type) { 1 { 'insert' } 2 { 'delete' } default { 'other' } }
                    $txt = ''
                    try { $txt = ("" + $r.Range.Text) } catch { }
                    $ctx = ''
                    try {
                        $s = [Math]::Max(0, [int]$r.Range.Start - 60)
                        $e = [Math]::Min($docEnd, [int]$r.Range.End + 60)
                        $ctx = ("" + $script:doc.Range($s, $e).Text) -replace '\s+', ' '
                        $ctx = $ctx.Trim()
                    } catch { }
                    $para = 0
                    try { $para = [int]$r.Range.Information(10) } catch { }  # wdActiveEndAdjustedPageNumber
                    $revs += @{ type = $t; text = $txt.Trim(); context = $ctx; page = $para }
                }
                Write-Result @{ ok = $true; op = 'readRevisions'; revisions = $revs; count = $revs.Count }
            }

            'setPrintLayout' {
                # Print-ready Word page geometry (typeset_print_ready): trim size,
                # binding gutter, mirrored margins, odd/even running heads. NOT
                # press-grade typesetting (ADR-0025) — Word's own engine only.
                Require-Doc
                $cm = 28.3464567
                $ps = $script:doc.PageSetup
                if ($cmd.pageWidthCm)  { $ps.PageWidth  = [double]$cmd.pageWidthCm  * $cm }
                if ($cmd.pageHeightCm) { $ps.PageHeight = [double]$cmd.pageHeightCm * $cm }
                if ($null -ne $cmd.gutterCm)   { $ps.Gutter = [double]$cmd.gutterCm * $cm }
                if ($null -ne $cmd.mirrorMargins)     { $ps.MirrorMargins = [bool]$cmd.mirrorMargins }
                # NOTE: these two are plain Boolean COM properties, not WdConstant
                # ints — Word's own setter rejects an Int32 VARIANT here ("Value
                # does not fall within the expected range"), even though generic
                # numeric-to-bool VARIANT coercion would normally accept it. Cast
                # to [bool] only, matching MirrorMargins above. Confirmed live
                # against Word 16.0 (hostLive.test.ts).
                if ($null -ne $cmd.oddEven)           { $ps.OddAndEvenPagesHeaderFooter = [bool]$cmd.oddEven }
                if ($null -ne $cmd.differentFirstPage) { $ps.DifferentFirstPageHeaderFooter = [bool]$cmd.differentFirstPage }
                if ([bool]$cmd.startRecto) { try { $script:doc.Sections.Item(1).PageSetup.SectionStart = 4 } catch { } }  # wdSectionNewOddPage
                if ($cmd.headerOdd -or $cmd.headerEven) {
                    foreach ($sec in $script:doc.Sections) {
                        if ($cmd.headerOdd)  { $sec.Headers.Item(1).Range.Text = "" + $cmd.headerOdd }   # wdHeaderFooterPrimary
                        if ($cmd.headerEven) { $sec.Headers.Item(3).Range.Text = "" + $cmd.headerEven }  # wdHeaderFooterEvenPages
                    }
                }
                # M11 Phase 4: configurable margins + line spacing (ADR-0048)
                if ($null -ne $cmd.marginTopCm)    { $ps.TopMargin    = [double]$cmd.marginTopCm * $cm }
                if ($null -ne $cmd.marginBottomCm) { $ps.BottomMargin = [double]$cmd.marginBottomCm * $cm }
                if ($null -ne $cmd.marginLeftCm)   { $ps.LeftMargin   = [double]$cmd.marginLeftCm * $cm }
                if ($null -ne $cmd.marginRightCm)  { $ps.RightMargin  = [double]$cmd.marginRightCm * $cm }
                if ($null -ne $cmd.lineSpacingPt) {
                    foreach ($sec in $script:doc.Sections) {
                        $sec.Range.ParagraphFormat.LineSpacingRule = 0  # wdLineSpaceExactly
                        $sec.Range.ParagraphFormat.LineSpacing = [double]$cmd.lineSpacingPt
                    }
                }
                Write-Result @{ ok = $true; op = 'setPrintLayout'; pageWidth = $ps.PageWidth; pageHeight = $ps.PageHeight; gutter = $ps.Gutter }
            }

            'markIndexEntries' {
                # Insert Word XE (index-entry) fields at every occurrence of each
                # `find` term. build_scholarly_indexes builds the entry list.
                Require-Doc
                $marked = 0
                $docEnd0 = $script:doc.Content.End
                foreach ($e in $cmd.entries) {
                    $find = "" + $e.find
                    $entry = ("" + $e.entry) -replace '"', ''
                    if ($find -eq '' -or $entry -eq '') { continue }
                    $rng = $script:doc.Range(0, $script:doc.Content.End)
                    while ($true) {
                        $f = $rng.Find
                        $f.ClearFormatting()
                        $f.Text = $find
                        $f.Forward = $true
                        $f.Wrap = 0
                        $f.MatchWildcards = $false
                        if (-not $f.Execute()) { break }
                        $ip = $script:doc.Range($rng.End, $rng.End)
                        $script:doc.Fields.Add($ip, 4, ('"' + $entry + '"'), $false) | Out-Null  # wdFieldIndexEntry
                        $marked++
                        $next = $ip.End + 1
                        $docEnd = $script:doc.Content.End
                        if ($next -ge $docEnd) { break }
                        $rng = $script:doc.Range($next, $docEnd)
                    }
                }
                Write-Result @{ ok = $true; op = 'markIndexEntries'; marked = $marked }
            }

            'appendIndex' {
                # Append a section break, an optional heading, then an INDEX or
                # TOC field, and update it. The XE fields must already be in place
                # for INDEX (see markIndexEntries).
                #
                # NOTE: Document.Range(Content.End, Content.End) throws "Value out
                # of range" — Content.End points one past the final paragraph mark,
                # which Word's Range() rejects as a zero-width boundary. The
                # standard idiom is Content.End - 1. Confirmed live against Word
                # 16.0 (hostLive.test.ts).
                Require-Doc
                $end = $script:doc.Range($script:doc.Content.End - 1, $script:doc.Content.End - 1)
                $end.InsertBreak(2)  # wdSectionBreakNextPage
                $end = $script:doc.Range($script:doc.Content.End - 1, $script:doc.Content.End - 1)
                if ($cmd.heading) {
                    $end.InsertAfter(("" + $cmd.heading) + "`r")
                    try { $script:doc.Paragraphs.Last.Previous().Range.Style = $script:doc.Styles.Item(-2) } catch { }  # wdStyleHeading1
                    $end = $script:doc.Range($script:doc.Content.End - 1, $script:doc.Content.End - 1)
                }
                $fieldCode = if ("$($cmd.field)".ToUpper() -eq 'TOC') { 'TOC \o "1-3" \h' } else { 'INDEX \c "1" \z "1025"' }
                $script:doc.Fields.Add($end, -1, $fieldCode, $true) | Out-Null  # wdFieldEmpty
                $script:doc.Fields.Update() | Out-Null
                Write-Result @{ ok = $true; op = 'appendIndex'; field = $cmd.field }
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
