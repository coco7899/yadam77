param(
    [string]$DashboardRoot,
    [ValidateRange(1,65535)][int]$DashboardPort = 8790,
    [Alias('SessionId')][string]$ChatId = $env:CODEX_THREAD_ID,
    [switch]$NewSession
)
$ErrorActionPreference = 'Stop'
if ($ChatId -notmatch '^[a-zA-Z0-9_-]{1,96}$') { throw '현재 채팅 ID가 필요합니다. CODEX_THREAD_ID 또는 -ChatId로 전달하세요.' }
$baseUrl = "http://127.0.0.1:$DashboardPort"
$dashboardUrl = "$baseUrl/?session=$ChatId"
$skillRoot = Split-Path $PSScriptRoot -Parent
$workspaceRoot = $env:YADAM_WORKSPACE_ROOT
if (-not $workspaceRoot) {
    $workspaceRoot = if (Test-Path -LiteralPath 'D:\1CODEX' -PathType Container) {
        'D:\1CODEX'
    } else {
        Join-Path $env:USERPROFILE 'CodexProjects'
    }
}
$workspaceRoot = [IO.Path]::GetFullPath($workspaceRoot)
if (-not $DashboardRoot) { $DashboardRoot = Join-Path $workspaceRoot '야담제작소웹' }
$DashboardRoot = [IO.Path]::GetFullPath($DashboardRoot)
$serverPath = Join-Path $DashboardRoot 'server.mjs'
function Get-DashboardHealth {
    try { Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2 }
    catch { return $null }
}
function Test-Dashboard {
    $health = Get-DashboardHealth
    return $health -and $health.service -eq 'lala-yadam-dashboard' -and $health.version -eq 2 -and
        $health.workflowOrderVersion -eq 3 -and $health.sceneImageReviewChoice -eq $true -and $health.usageNoticeVersion -eq 1 -and $health.topicChoice -eq $true -and [IO.Path]::GetFullPath($health.root) -eq $DashboardRoot
}
if (-not (Test-Dashboard)) {
    $health = Get-DashboardHealth
    $listener = Get-NetTCPConnection -LocalPort $DashboardPort -State Listen -ErrorAction SilentlyContinue
    if ($health -or $listener) {
        throw "$DashboardPort 포트에 기존 서버가 실행 중입니다. 이 작업실의 이전 현황표 서버를 직접 종료한 뒤 다시 실행하세요."
    }
    # Refresh only shipped program files. Saved sessions and channel settings are outside this list.
    $bundledRoot = Join-Path $skillRoot 'assets\dashboard'
    New-Item -ItemType Directory -Path (Join-Path $DashboardRoot 'dist') -Force | Out-Null
    foreach ($file in @('server.mjs','cleanup.mjs','project-layout.mjs','scene-image-review.mjs','dist\app.js','dist\index.html','dist\style.css')) {
        $source = Join-Path $bundledRoot $file
        $target = Join-Path $DashboardRoot $file
        if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash) {
            Copy-Item -LiteralPath $source -Destination $target -Force
        }
    }
}
$stateDir = Join-Path $DashboardRoot "state\sessions\$ChatId"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$statusPath = Join-Path $stateDir 'steps.json'
$currentPath = Join-Path $stateDir 'current-work.json'
if ($NewSession -or -not (Test-Path -LiteralPath $statusPath)) {
    if ($NewSession -and (Test-Path -LiteralPath $statusPath) -and (Test-Path -LiteralPath $currentPath)) {
        $previous = Get-Content -LiteralPath $currentPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($previous.projectPath -and (Test-Path -LiteralPath $previous.projectPath -PathType Container)) {
            @{steps=(Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json);currentWork=$previous;chatId=$ChatId} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $previous.projectPath '현황표상태.json') -Encoding utf8
        }
    }
    [IO.File]::WriteAllText($statusPath,'{}')
    @{skill='77-yadam-capcut-production';workflowOrderVersion=3;dashboardSession=$ChatId;step=0;status='idle';projectPath=$null;topic=$null;duration=$null;nextInput='1단계 주제·길이 선택';interactionMode='chat_with_read_only_dashboard'} | ConvertTo-Json | Set-Content -LiteralPath $currentPath -Encoding utf8
}
# Migrate only this chat to the 13-stage workflow.
if (Test-Path -LiteralPath $currentPath) {
    $current = Get-Content -LiteralPath $currentPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = [int]$current.workflowOrderVersion
    $changed = $false
    if ($version -lt 3) {
        $oldSteps = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $mapped = [ordered]@{}
        foreach ($item in $oldSteps.PSObject.Properties) {
            $key = $item.Name
            if ($version -lt 2) {
                $key = switch ($key) { '10' {'11'} '11' {'13'} '12' {'10'} default {$key} }
            } elseif ($key -eq '12') { $key = '13' }
            $mapped[$key] = $item.Value
        }
        $orderedSteps = [ordered]@{}
        foreach ($n in 1..13) {
            $key = [string]$n
            if ($mapped.Contains($key)) { $orderedSteps[$key] = $mapped[$key] }
        }
        $orderedSteps | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statusPath -Encoding utf8
        $current | Add-Member -NotePropertyName workflowOrderVersion -NotePropertyValue 3 -Force
        if ($current.projectStatus -eq 'closed') {
            $current.step = if ($version -lt 2) {
                switch ($current.step) { 10 {11} 11 {13} 12 {10} default {$current.step} }
            } elseif ($current.step -eq 12) { 13 } else { $current.step }
        } elseif ($current.projectPath) {
            $next = 1..13 | Where-Object { $orderedSteps[[string]$_].state -ne 'completed' } | Select-Object -First 1
            $current.step = $next
            $current.status = 'awaiting_input'
            $current | Add-Member -NotePropertyName projectStatus -NotePropertyValue 'in_progress' -Force
            $current | Add-Member -NotePropertyName nextInput -NotePropertyValue "${next}단계 작업을 채팅에서 이어가세요." -Force
        }
        $changed = $true
    }
    $legacyRoot = Join-Path (Split-Path $DashboardRoot -Parent) '야담작업'
    $heartRoot = Join-Path (Split-Path $DashboardRoot -Parent) '❤️야담작업'
    if ($current.projectPath -and $current.projectPath.StartsWith($legacyRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and -not (Test-Path -LiteralPath $current.projectPath)) {
        $rel = $current.projectPath.Substring($legacyRoot.Length + 1)
        $candidate = Join-Path $heartRoot $rel
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            $current.projectPath = $candidate
            $changed = $true
        }
    }
    if ($changed) {
        $current | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $currentPath -Encoding utf8
    }
}

$started = $false
if (-not (Test-Dashboard)) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $runtime = Join-Path $DashboardRoot '.runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $previousPort = $env:PORT
    $previousWorkspace = $env:YADAM_WORKSPACE_ROOT
    try {
        $env:PORT = [string]$DashboardPort
        $env:YADAM_WORKSPACE_ROOT = $workspaceRoot
        $process = Start-Process -FilePath $node -ArgumentList @(('"' + $serverPath + '"')) -WorkingDirectory $DashboardRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    } finally {
        $env:PORT = $previousPort
        $env:YADAM_WORKSPACE_ROOT = $previousWorkspace
    }
    $started = $true
    $ready = $false
    for ($attempt=0; $attempt -lt 8; $attempt++) {
        if (Test-Dashboard) { $ready=$true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw '현황표 시작을 확인하지 못했습니다. .runtime/server-error.log를 확인하세요.' }
    [IO.File]::WriteAllText((Join-Path $runtime 'server.pid'),[string]$process.Id)
}
$check = Invoke-RestMethod -Uri "$baseUrl/api/snapshot?session=$ChatId" -TimeoutSec 2
if ($check.session -ne $ChatId) { throw '채팅별 현황표 연결 검증 실패' }
@{url=$dashboardUrl;chat_id=$ChatId;channel_name=$check.channelName;dashboard_root=$DashboardRoot;status_path=$statusPath;current_work_path=$currentPath;started=$started;reset=[bool]$NewSession;ready=$true} | ConvertTo-Json -Compress
