# 77 야담 제작 스킬

Codex에서 야담 대본, 더빙 원고, 2D 인물과 실사 배경을 사용한 장면 이미지, CapCut 편집 자료, 유튜브 썸네일을 준비하는 Windows용 스킬입니다. 로컬 제작 현황표와 스타일 예시를 함께 제공합니다.

진행현황표는 13단계입니다. 본편 검수와 CapCut 인계, 인트로 제작을 마친 뒤 **12단계 고정화자 영상제작 → 13단계 썸네일·업로드 준비**로 이어집니다.

본편 제작이 CapCut 인계까지 끝난 뒤 수정된 장면 이미지가 감지되면 현황표에서 **8~10단계 다시 진행** 또는 **기존 결과 유지**를 선택합니다. 본편 작업 중에는 이미지를 계속 추가할 수 있습니다.

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

기존 설치를 갱신할 때는 저장소에서 `git pull`을 실행한 뒤 위의 스킬 복사 명령을 다시 실행하세요. 이전 현황표 서버가 실행 중이면 종료한 뒤 Codex에서 **77**로 열면 현황표 프로그램이 갱신됩니다. 기존 채팅을 열면 이전 12단계 썸네일·업로드 기록은 13단계로 옮겨지고 새 12단계 고정화자는 미완료로 표시됩니다.

CapCut 연동과 이미지 생성은 새 PC의 Codex에서 사용할 수 있는 기능과 각 서비스 계정에 따릅니다. 작품 파일과 현황표 세션은 각 PC에 저장되므로, 기존 작품을 이어갈 경우 작업 자료를 별도로 옮긴 뒤 경로를 확인하세요.
