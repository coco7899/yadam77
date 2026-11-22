param(
    [string]$DashboardRoot,
    [Alias('SessionId')][string]$ChatId = $env:CODEX_THREAD_ID,
    [switch]$NewSession
)
$ErrorActionPreference = 'Stop'
if ($ChatId -notmatch '^[a-zA-Z0-9_-]{1,96}$') { throw '현재 채팅 ID가 필요합니다. CODEX_THREAD_ID 또는 -ChatId로 전달하세요.' }
$baseUrl = 'http://127.0.0.1:8790'
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
$env:YADAM_WORKSPACE_ROOT = $workspaceRoot
if (-not $DashboardRoot) { $DashboardRoot = Join-Path $workspaceRoot '야담제작소웹' }
$DashboardRoot = [IO.Path]::GetFullPath($DashboardRoot)
$serverPath = Join-Path $DashboardRoot 'server.mjs'
if (-not (Test-Path -LiteralPath $serverPath)) {
    New-Item -ItemType Directory -Path $DashboardRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $skillRoot 'assets\dashboard\server.mjs') -Destination $serverPath
}
if (-not (Test-Path -LiteralPath (Join-Path $DashboardRoot 'cleanup.mjs'))) {
    Copy-Item -LiteralPath (Join-Path $skillRoot 'assets\dashboard\cleanup.mjs') -Destination (Join-Path $DashboardRoot 'cleanup.mjs')
}
if (-not (Test-Path -LiteralPath (Join-Path $DashboardRoot 'project-layout.mjs'))) {
    Copy-Item -LiteralPath (Join-Path $skillRoot 'assets\dashboard\project-layout.mjs') -Destination (Join-Path $DashboardRoot 'project-layout.mjs')
}
if (-not (Test-Path -LiteralPath (Join-Path $DashboardRoot 'dist'))) {
    Copy-Item -LiteralPath (Join-Path $skillRoot 'assets\dashboard\dist') -Destination (Join-Path $DashboardRoot 'dist') -Recurse
}
$stateDir = Join-Path $DashboardRoot "state\sessions\$ChatId"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$statusPath = Join-Path $stateDir 'steps.json'
$currentPath = Join-Path $stateDir 'current-work.json'
if ($NewSession -or -not (Test-Path -LiteralPath $statusPath)) {
    if ($NewSession -and (Test-Path -LiteralPath $statusPath) -and (Test-Path -LiteralPath $currentPath)) {
        $previous = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
        if ($previous.projectPath -and (Test-Path -LiteralPath $previous.projectPath -PathType Container)) {
            @{steps=(Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json);currentWork=$previous;chatId=$ChatId} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $previous.projectPath '현황표상태.json') -Encoding utf8
        }
    }
    [IO.File]::WriteAllText($statusPath,'{}')
    @{skill='77-yadam-capcut-production';workflowOrderVersion=2;dashboardSession=$ChatId;step=0;status='idle';projectPath=$null;topic=$null;duration=$null;nextInput='1단계 주제·길이 선택';interactionMode='chat_with_read_only_dashboard'} | ConvertTo-Json | Set-Content -LiteralPath $currentPath -Encoding utf8
}
# Migrate this chat only; other chats retain their saved numbering until resumed.
if (Test-Path -LiteralPath $currentPath) {
    $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
    if (-not $current.workflowOrderVersion -or $current.workflowOrderVersion -lt 2) {
        $oldSteps = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $mapped = @{}
        foreach ($item in $oldSteps.PSObject.Properties) {
            $key = switch ($item.Name) { '10' {'11'} '11' {'12'} '12' {'10'} default {$item.Name} }
            $mapped[$key] = $item.Value
        }
        $orderedSteps = [ordered]@{}
        foreach ($n in 1..12) { $key=[string]$n; if ($mapped.ContainsKey($key)) { $orderedSteps[$key]=$mapped[$key] } }
        $orderedSteps | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $statusPath -Encoding utf8
        if ($current.step -eq 10) { $current.step=11 } elseif ($current.step -eq 11) { $current.step=12 } elseif ($current.step -eq 12) { $current.step=10 }
        $current | Add-Member -NotePropertyName workflowOrderVersion -NotePropertyValue 2 -Force
        $current | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $currentPath -Encoding utf8
    }
}
function Test-Dashboard {
    try {
        $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
        return $health.service -eq 'lala-yadam-dashboard' -and $health.version -eq 2 -and [IO.Path]::GetFullPath($health.root) -eq $DashboardRoot
    } catch { return $false }
}
$started = $false
if (-not (Test-Dashboard)) {
    $listener = Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw '8790 포트의 서버가 다른 작업실 또는 이전 버전입니다. 임의 종료하지 말고 해당 작업실을 확인하세요.' }
    $node = (Get-Command node -ErrorAction Stop).Source
    $runtime = Join-Path $DashboardRoot '.runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $process = Start-Process -FilePath $node -ArgumentList @(('"' + $serverPath + '"')) -WorkingDirectory $DashboardRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
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
@{url=$dashboardUrl;chat_id=$ChatId;dashboard_root=$DashboardRoot;status_path=$statusPath;current_work_path=$currentPath;started=$started;reset=[bool]$NewSession;ready=$true} | ConvertTo-Json -Compress
