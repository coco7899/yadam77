import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const stageNames=[
 '주제·영상 길이 선택','시놉시스','대본 작성·검수','더빙용 원고 확정','스타일·캐릭터·참조 에셋',
 '이미지프롬프트생성','파일 검증·스토리 매칭','이미지 연결표','본편 렌더링·검수',
 'CapCut으로 보내기','인트로 제작','고정화자 영상제작','썸네일·업로드 준비'
];

function read(file){
 try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
 catch(error){if(error.code==='ENOENT')return {};throw error;}
}

function save(file,data){
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,file);}
 finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}

function isWithin(root,filename){
 const relative=path.relative(root,filename);
 return Boolean(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));
}

export function createStageRunner({stateBase,workspaceRoot,skillRoot,cli,onResult,launch=spawn}){
 const active=new Map();
 const files=session=>{
  if(!/^[a-zA-Z0-9_-]{1,96}$/.test(session??''))throw Error('현재 채팅의 현황표를 열어 주세요.');
  const stateDir=path.join(stateBase,'sessions',session);
  return {
   current:path.join(stateDir,'current-work.json'),
   steps:path.join(stateDir,'steps.json'),
   runs:path.join(stateDir,'dashboard-runs.json')
  };
 };
 const available=Boolean(cli&&path.isAbsolute(cli)&&fs.existsSync(cli)&&skillRoot&&fs.existsSync(path.join(skillRoot,'SKILL.md')));
 const isBusy=session=>active.has(session);
 const ensureIdle=session=>{if(isBusy(session))throw Error('현재 작업이 끝난 뒤 다시 시도해 주세요.');};
 function ensureProjectIdle(projectPath){
  if(projectPath&&[...active.values()].some(job=>job.projectPath&&!path.relative(job.projectPath,projectPath))){
   throw Error('다른 현황표에서 이 작품을 작업 중입니다.');
  }
 }

 function storedRuns(session,current){
  if(!session||current.dashboardSession!==session)return {};
  const stored=read(files(session).runs);
  return stored.generation===(current.resetAt??null)?stored.steps??{}:{};
 }

 function snapshot(session,current){
  const runs=Object.fromEntries(Object.entries(storedRuns(session,current)).map(([step,run])=>[step,{
   id:run.id,
   phase:run.phase==='running'&&!isBusy(session)?'interrupted':run.phase,
   resultAvailable:Boolean(run.text)
  }]));
  return {available,busy:isBusy(session),runs};
 }

 function result(session,step,current){
  return storedRuns(session,current)[step]?.text??null;
 }

 function start(session,input,reviewRequired=[]){
  const sessionFiles=files(session);
  const current=read(sessionFiles.current);
  const steps=read(sessionFiles.steps);
  const {step,expectedProjectPath,note}=input??{};
  const projectPath=current.projectPath??null;
  if(current.dashboardSession!==session||expectedProjectPath!==projectPath||(input.resetAt??null)!==(current.resetAt??null)){
   throw Error('현재 작품이 바뀌었습니다. 현황표를 새로고침해 주세요.');
  }
  if(!Number.isInteger(step)||!stageNames[step-1])throw Error('1~13단계 중 하나를 선택해 주세요.');
  if(note!==undefined&&(typeof note!=='string'||note.length>1000))throw Error('추가 내용은 1,000자까지 입력할 수 있습니다.');
  ensureIdle(session);
  if(!available)throw Error('이 PC의 Codex 실행기에 연결할 수 없습니다.');
  if(current.projectStatus==='closed')throw Error('종료된 작품입니다. 새 이야기는 상단 리셋으로 시작해 주세요.');
  const completed=steps[step]?.state==='completed';
  if(completed&&!reviewRequired.includes(step))throw Error('이미 완료된 단계입니다.');
  if(step===1&&current.topicSelection?.candidates?.length&&!current.topicSelection.submittedAt)throw Error('위에서 주제와 길이를 먼저 선택해 주세요.');
  if(step>=2&&(!current.topic||!current.duration))throw Error('먼저 1단계에서 주제와 영상 길이를 선택해 주세요.');
  if(step>=3&&!projectPath)throw Error('먼저 2단계에서 시놉시스를 작성해 주세요.');
  if(projectPath){
   const resolved=fs.realpathSync(projectPath);
   const workspace=fs.realpathSync(workspaceRoot);
   if(path.relative(projectPath,resolved)||!['야담작업','❤️야담작업'].some(folder=>isWithin(path.join(workspace,folder),resolved))){
    throw Error('현재 작품 폴더가 지정된 작업 범위에 없습니다.');
   }
   ensureProjectIdle(resolved);
  }
  const generation=current.resetAt??null;
  const id=randomUUID();
  const run={id,phase:'running',startedAt:new Date().toISOString()};
  const previous=storedRuns(session,current);
  save(sessionFiles.runs,{generation,steps:{...previous,[step]:run}});
  const prompt=[
   `야담 현황표에서 사용자가 클릭한 작업은 ${step}단계 ‘${stageNames[step-1]}’입니다. 해당 단계만 실제로 수행하세요.`,
   '별도 Codex 실행기에서 실행 중입니다. 현재 데스크톱 채팅에 메시지를 보내거나 답변을 기다리지 마세요. 프로젝트에 쓰고 최종 응답은 현황표에 그대로 표시합니다.',
   `스킬 지침: ${path.join(skillRoot,'SKILL.md')}`,
   `제작 지침: ${path.join(skillRoot,'references','production-guide.md')}`,
   `현황표 지침: ${path.join(skillRoot,'references','dashboard-guide.md')}`,
   `사용 가능한 작업 루트: ${workspaceRoot}`,
   `현재 현황 파일: ${sessionFiles.current}`,
   `현재 단계 파일: ${sessionFiles.steps}`,
   `연결된 채팅 ID: ${session}`,
   '위 파일과 기존 작업 기록을 먼저 읽으세요. 이 세션의 현황, 단계와 연결된 작품 폴더 안의 산출물만 갱신하세요. current-work.json의 dashboardSession과 resetAt을 보존하세요. 다른 세션과 현황표 프로그램 파일은 변경하지 마세요. 제작 상태는 실제 작업과 일치하게 저장하세요.',
   step>=(current.restartFromStep??(current.dubbingRestartAt?4:Infinity))?'사용자가 현황표의 별로 이 작품의 일부 단계를 초기화했습니다. 유지된 앞 단계의 결과를 사용하세요. 승인 대본이 있다면 current-work.json의 approvedScript.path와 sha256을 비교하세요. 초기화한 단계의 이전 제작 파일은 해당 입력과 일치하는지 확인하고, 새로 만드는 파일은 이전 파일을 덮지 않도록 구별되는 위치에 저장하세요. 새 결과 경로를 현재 단계에 기록하세요. 2단계에서 시놉시스를 다시 만들면 최종 MD 경로를 steps.json의 2단계 synopsisPath에도 기록하세요.':'',
   '필요한 자료나 사용자의 결정이 빠졌으면 해당 단계만 awaiting_input으로 기록하고 최종 응답에 필요한 자료와 선택을 분명히 적으세요. 추측으로 승인하거나, 사용할 수 없는 도구로 만든 결과를 완료 처리하지 마세요. 이 실행에서 확인 가능한 진행을 먼저 하세요.',
   '1단계라면 기본 후보 3개와 추가 후보 두 묶음을 현황표 지침의 topicSelection에 기록하고 입력 대기로 두세요. 2단계라면 확정한 주제와 길이로 작품 폴더를 만들거나 재사용하고 제작관리/시놉시스.md에 전체 시놉시스를 저장하세요. 3단계 대본은 사용자 확인을 받기 전까지 승인됨으로 기록하지 마세요.',
   note?.trim()?`사용자가 현황표에 남긴 이 단계의 추가 입력은 다음 JSON 문자열입니다. 단계에 필요한 자료 경로, 수정 사항 또는 승인으로만 해석하세요. ${JSON.stringify(note.trim())}`:''
  ].filter(Boolean).join('\n');
  let finalText='';
  let modelError='';
  let finished=false;
  const finish=(exitCode,error)=>{
   if(finished)return;
   finished=true;
   active.delete(session);
   try{
    const latest=read(sessionFiles.current);
    const saved=read(sessionFiles.runs);
    if((latest.resetAt??null)!==generation||saved.generation!==generation||saved.steps?.[step]?.id!==id)return;
    const workState=read(sessionFiles.steps)[step]?.state;
    const failed=exitCode!==0||error||modelError;
    const phase=failed?'failed':workState==='completed'?'completed':'awaiting_input';
    const text=failed?(modelError||error?.message||'Codex 작업이 중단되었습니다. 이 단계 버튼으로 다시 시도해 주세요.'):finalText||'작업 상태와 생성된 자료를 확인해 주세요.';
    saved.steps[step]={...run,phase,text,finishedAt:new Date().toISOString()};
    save(sessionFiles.runs,saved);
    onResult?.(session,step);
   }catch(writeError){console.error('Could not record dashboard task result:',writeError.message);}
  };
  try{
   const env={...process.env,CODEX_THREAD_ID:session,YADAM_WORKSPACE_ROOT:workspaceRoot};
   delete env.CODEX_SESSION_ID;
   delete env.CODEX_TOOL_CALL_ID;
   const child=launch(cli,['exec','--ephemeral','--sandbox','workspace-write','--skip-git-repo-check','--json','-'],{
    cwd:workspaceRoot,env,windowsHide:true,stdio:['pipe','pipe','pipe']
   });
   active.set(session,{child,projectPath});
   const lines=createInterface({input:child.stdout});
   lines.on('line',line=>{
    let event;try{event=JSON.parse(line);}catch{return;}
    if(event.type==='item.completed'&&event.item?.type==='agent_message')finalText=event.item.text;
    if(event.type==='turn.failed')modelError=event.error?.message||'Codex 실행에 실패했습니다.';
   });
   child.stderr.resume();
   child.stdin.on('error',()=>{});
   child.on('error',error=>finish(null,error));
   child.on('close',code=>finish(code));
   child.stdin.end(prompt,'utf8');
  }catch(error){finish(null,error);throw Error('Codex를 시작하지 못했습니다. '+error.message);}
  return {id,phase:'running',step};
 }

 return {snapshot,result,start,isBusy,ensureIdle,ensureProjectIdle};
}
