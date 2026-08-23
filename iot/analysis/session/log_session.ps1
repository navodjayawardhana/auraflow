# AuraFlow — HR agreement session logger
#
# Run this in ONE sitting, resting, for ~5-10 minutes. It logs every valid node
# HR reading to node_hr.csv continuously in the background. Whenever you glance
# at the watch, just type the number it shows and press Enter — that gets
# paired against whatever the node's most recent reading was and appended to
# watch_hr.csv with the same timestamp, so validate_hr.py can match them.
#
# Usage:  powershell -File log_session.ps1
# Stop:   type q and press Enter, or Ctrl+C
#
# Repeat this for a few sessions (per validate_hr.py's own guidance: 3 sessions
# x 5 min at rest, plus one after light exercise) until node_hr.csv has 20+
# rows, then run validate_hr.py.

param([string]$Port = "COM8")

$dir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCsv  = Join-Path $dir "node_hr.csv"
$watchCsv = Join-Path $dir "watch_hr.csv"

if (-not (Test-Path $nodeCsv))  { "recorded_at,hr_bpm,hr_bpm_maxim,settled" | Out-File $nodeCsv -Encoding utf8 }
if (-not (Test-Path $watchCsv)) { "recorded_at,hr_bpm" | Out-File $watchCsv -Encoding utf8 }

$latestHr  = $null
$latestTs  = $null
$sync      = [hashtable]::Synchronized(@{ hr = $null; maxim = $null; settled = $null; ts = $null })

$port = New-Object System.IO.Ports.SerialPort $Port,115200,None,8,One
$port.ReadTimeout = 2000
$port.Open()

# A background runspace reads serial continuously so typing a watch value never
# has to wait for or block a read. It parses lines like:
#   [bio] hr=93.4(1) maxim=93(1) spo2=97(1) ir=158778 ... settling
# and keeps the hr and the maxim reading with their own validity flags. The (1) is
# the node's own valid flag; a (0) is the estimator saying it could not resolve a
# rate, and is not something to pair against the watch.
#
# Both estimators are captured because validate_hr.py compares them to each other as
# well as to the watch, and that comparison is the whole reason the firmware publishes
# two. `settling` is recorded too: the window estimators are not final until it clears,
# so a run can be analysed with and without those samples.
$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$rs.SessionStateProxy.SetVariable("port", $port)
$rs.SessionStateProxy.SetVariable("sync", $sync)
$ps = [powershell]::Create()
$ps.Runspace = $rs
[void]$ps.AddScript({
    while ($true) {
        try {
            $line = $port.ReadLine()
        } catch { continue }
        # Fractional: the streaming estimator resolves a decimal, and the integer-only
        # pattern this line used to carry stopped matching the moment it did -- which is
        # why a session that ran for minutes left two rows behind.
        if ($line -match '\[bio\]\s+hr=(-?[\d.]+)\((\d)\)') {
            if ($Matches[2] -eq '1') {
                $sync.hr = [double]$Matches[1]
                $sync.ts = Get-Date

                # Recorded alongside rather than in place of: an unresolved maxim reading
                # beside a good streaming one is itself a result about the two estimators.
                if ($line -match 'maxim=(-?\d+)\((\d)\)' -and $Matches[2] -eq '1') {
                    $sync.maxim = [int]$Matches[1]
                } else {
                    $sync.maxim = $null
                }

                $sync.settled = if ($line -match 'settling') { 0 } else { 1 }
            }
        }
    }
})
$handle = $ps.BeginInvoke()

Write-Host "Logging $Port -> $nodeCsv"
Write-Host "Type the watch's bpm and press Enter whenever you check it. 'q' to stop.`n"

try {
    while ($true) {
        if ($sync.hr -ne $null) {
            $age = ((Get-Date) - $sync.ts).TotalSeconds
            $m = if ($sync.maxim -eq $null) { "--" } else { $sync.maxim }
            $tag = if ($sync.settled -eq 1) { "" } else { " settling" }
            Write-Host ("`rnode: {0,5:N1} maxim: {1,3}{2}  ({3:N0}s ago)   > " -f $sync.hr, $m, $tag, $age) -NoNewline
        }
        $input = Read-Host
        if ($input -eq "q") { break }

        $watchBpm = 0
        if (-not [int]::TryParse($input, [ref]$watchBpm)) {
            Write-Host "  (not a number, skipped)"
            continue
        }
        if ($sync.hr -eq $null -or ((Get-Date) - $sync.ts).TotalSeconds -gt 15) {
            Write-Host "  (no fresh node reading in the last 15s — finger may be off. skipped)"
            continue
        }

        $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
        $maxim = if ($sync.maxim -eq $null) { "" } else { $sync.maxim }
        "$ts,$($sync.hr),$maxim,$($sync.settled)" | Out-File $nodeCsv -Append -Encoding utf8
        "$ts,$watchBpm"   | Out-File $watchCsv -Append -Encoding utf8
        $n = (Get-Content $nodeCsv | Measure-Object -Line).Lines - 1
        Write-Host "  paired: node=$($sync.hr) watch=$watchBpm  (n=$n so far)"
    }
} finally {
    $ps.Stop()
    $rs.Close()
    if ($port.IsOpen) { $port.Close() }
    $n = (Get-Content $nodeCsv | Measure-Object -Line).Lines - 1
    Write-Host "`nSession ended. $n pairs total in $nodeCsv / $watchCsv."
    if ($n -ge 20) {
        Write-Host "That's 20+ — run: python ..\validate_hr.py node_hr.csv watch_hr.csv"
    } else {
        Write-Host "Need $(20 - $n) more. Run this script again for another session."
    }
}
