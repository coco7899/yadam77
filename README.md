# 77 야담 제작 스킬

Codex에서 야담 대본, 더빙 원고, 2D 인물과 실사 배경을 사용한 장면 이미지, CapCut 편집 자료, 유튜브 썸네일을 준비하는 Windows용 스킬입니다. 로컬 제작 현황표와 스타일 예시를 함께 제공합니다.

## 다른 Windows PC에 설치

Git, Node.js, Codex 데스크톱을 설치하고, 비공개 저장소에 접근할 수 있는 GitHub 계정으로 인증합니다. PowerShell에서 다음을 실행하세요.

```powershell
$workspace = if (Test-Path -LiteralPath 'D:\1CODEX') { 'D:\1CODEX' } else { Join-Path $env:USERPROFILE 'CodexProjects' }
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
Set-Location -LiteralPath $workspace
git clone https://github.com/coco7899/yadam77.git
Set-Location -LiteralPath (Join-Path $workspace 'yadam77')

$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$skillsDir = Join-Path $codexRoot 'skills'
New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
Copy-Item -LiteralPath '.\77-yadam-capcut-production' -Destination $skillsDir -Recurse -Force
```

Codex를 다시 열고 **`$77-yadam-capcut-production`**을 선택하세요. 작업 중인 채팅에서 **77**을 입력하면 같은 현황표를 다시 엽니다. 현황표는 최초 실행 시 작업 루트의 `야담제작소웹`에 준비됩니다. 기본 작업 루트는 D 드라이브의 `D:\1CODEX` 또는 사용자 폴더의 `CodexProjects`입니다. 별도의 경로를 쓰려면 Codex 시작 전에 사용자 환경 변수 `YADAM_WORKSPACE_ROOT`를 설정하세요.

CapCut 연동과 이미지 생성은 새 PC의 Codex에서 사용할 수 있는 기능과 각 서비스 계정에 따릅니다. 작품 파일과 현황표 세션은 각 PC에 저장되므로, 기존 작품을 이어갈 경우 작업 자료를 별도로 옮긴 뒤 경로를 확인하세요.
