import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {createCleanup} from './cleanup.mjs';
import {createSceneImageReview} from './scene-image-review.mjs';
import {createStageRunner} from './stage-runner.mjs';
import {prepareResultTxt, queueResultTxt, readText, resultTxtPrompt, topicResult} from './result-text.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8790);
const base=path.join(root,'state');fs.mkdirSync(base,{recursive:true});
const workspaceRoot=process.env.YADAM_WORKSPACE_ROOT||path.dirname(root);
const preferredWorkRoot=path.join(workspaceRoot,'❤️야담작업');
const allowedRoot=fs.existsSync(preferredWorkRoot)?preferredWorkRoot:path.join(workspaceRoot,'야담작업');
const reviewImages=createSceneImageReview({allowedRoot});
const cleanup=createCleanup({
 stateBase:base,
 allowedRoot,
 reviewImages
});
const cli=process.env.YADAM_CODEX_CLI||process.env.CODEX_APP_RUNTIME_CLI_PATH;
const runner=createStageRunner({
 stateBase:base,workspaceRoot,skillRoot:process.env.YADAM_SKILL_ROOT,
 cli,onResult(session,step){prepareStageResult(session,path.join(base,'sessions',session),step);}
});
const profilePath=path.join(base,'channel-profile.json');
const sendingTxt=new Set();
const resultFields={
 2:['synopsisFile','synopsisPath'],
 3:['scriptPath'],
 4:['dubbingScriptPath','dubbingScriptValidationPath','dubbingClosingScriptPath'],
 5:['assetIndexPath','characterSheets','locationReferences','propReferences','referenceAssets'],
 6:['sceneList','shootingPlan','imagePrompts','timingTable','assetManifest','sceneListPath','shotPlanPath','scenePromptPath','promptPath','sceneTimingTablePath','timingTablePath'],
 7:['report','data','reviewPath','sceneImageReviewPath'],
 8:['data','linkPath','imageConnectionPath'],
 9:['report','finalMp4','videoPath','verificationPath','bodyVideoPath','bodyVideoVerificationPath'],
 10:['reportPath','capCutWebDraftReportPath'],
 11:['planPath','startImages','introPlanPath','introStartImages'],
 12:['report','videoPath'],
 13:['report','thumbnailPath','descriptionPath','uploadPackagePath']
};
const stageMetadata={
 2:['synopsisSummary','targetNarrationMinutes','targetSpokenCharacters'],
 3:['approvedScript','approvedScriptPath','scriptStatus','scriptReview'],
 4:['dubbingVerification'],
 6:['scenePlan','sceneTiming'],
 7:['sceneImages','sceneMatch'],
 8:['imageConnectionTable'],
 9:['mainRender'],
 10:['capCutWebDraft','capCutDraft'],
 11:['intro','introVideo'],
 12:['fixedNarrator'],
 13:['uploadPackage']
};
const wasReset=(step,current)=>step>=(current.restartFromStep??(current.dubbingRestartAt?4:Infinity));
const synopsisPath=(current,entry)=>entry?.synopsisFile??entry?.synopsisPath??current.synopsisFile??current.synopsisPath??
 (wasReset(2,current)?null:'제작관리/시놉시스.md');
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
function reply(res,code,data){res.writeHead(code,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function isInside(parent,item){
 const relative=path.relative(parent,item);
 return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}
function stageResult(session,step,current,entry,text){
 const empty={text,files:[],folder:null,project:null};
 if(!session||current.dashboardSession!==session||!path.isAbsolute(current.projectPath??''))return empty;
 let project;
 try{project=fs.realpathSync.native(current.projectPath);}
 catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))return empty;throw error;}
 if(!['야담작업','❤️야담작업'].some(name=>isInside(path.join(workspaceRoot,name),project)))return empty;
 const files=new Map();
 function add(value,label,detail){
  if(typeof value!=='string'||!value)return;
  const target=path.resolve(project,value);
  if(!isInside(project,target))return;
  try{
   const resolved=fs.realpathSync.native(target);
   if(!isInside(project,resolved)||!fs.statSync(resolved).isFile())return;
   const relative=path.relative(project,resolved).split(path.sep).join('/');
   if(!files.has(relative))files.set(relative,{path:relative,label:label||path.basename(resolved),detail});
   return resolved;
  }catch(error){if(!['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw error;}
 }
 if(step===2)add(synopsisPath(current,entry),'시놉시스');
 if(step===3){
  add(entry?.approvedScript??current.approvedScriptPath??(entry?.state==='completed'?'더빙원고/본문종합/대본.md':null),'승인 대본');
  add(entry?.artifact??current.scriptPath,'대본');
 }
 if(step===4){
  const manifest=add(entry?.dubbingVerification??current.dubbingVerificationPath??(entry?.state==='completed'&&!wasReset(step,current)?'더빙원고/분할더빙원고/분할검증.json':null),'분할 검증');
  if(manifest){
   files.clear();
   for(const item of read(manifest).files??[]){
    if(typeof item?.file!=='string'||item.file!==path.basename(item.file))continue;
    const label=item.file.replace(/^\d+_/,'').replace(/\.txt$/i,'').replace(/_/g,' ').replace('마무리나레이션','마무리 나레이션');
    const title=item.section&&item.section!== '마무리'?label+' · '+item.section.replace(/^제/,''):label;
    add(path.join(path.dirname(manifest),item.file),title,Number.isInteger(item.characters)?item.characters.toLocaleString('ko-KR')+'자':undefined);
   }
   add(manifest,'분할 검증');
  }
 }
 if(step===5){
  add(entry?.styleGuide??(entry?.state==='completed'&&!wasReset(step,current)?'이미지폴더/제작자료/이미지_스타일과_프롬프트.md':null),'이미지 기준과 프롬프트');
  add(entry?.assetManifest??(entry?.state==='completed'&&!wasReset(step,current)?'이미지폴더/에셋/참조에셋/에셋목록.json':null),'에셋 목록');
 }
 function addRecorded(value){
  if(Array.isArray(value)){for(const item of value)addRecorded(item);return;}
  if(value&&typeof value==='object'){add(value.path??value.file,value.label);return;}
  add(value);
 }
 addRecorded(entry?.resultFiles);
 for(const key of resultFields[step]??[]){
  addRecorded(entry?.[key]);
  addRecorded(current[key]);
 }
 for(const match of (text??'').matchAll(/\[([^\]\r\n]+)\]\((?:<([^>\r\n]+)>|([^()\r\n]+))\)/g)){
  const target=match[2]??match[3];
  if(!/^[a-z][a-z\d+.-]*:\/\//i.test(target)||path.isAbsolute(target))add(target,match[1]);
 }
 const entries=[...files.values()];
 let folder=null;
 if(entries.length){
  folder=path.dirname(path.resolve(project,entries[0].path));
  while(entries.some(file=>!isInside(folder,path.resolve(project,file.path))))folder=path.dirname(folder);
  folder=path.relative(project,folder).split(path.sep).join('/')||'.';
 }
 return {text,files:entries,folder,project};
}

function resultData(session,stateDir,step){
 const current=read(path.join(stateDir,'current-work.json'));
 if(!session||current.dashboardSession!==session)return null;
 const entry=read(path.join(stateDir,'steps.json'))[step];
 const synopsis=step===2?findSynopsis(session,current,entry):null;
 const text=synopsis?readText(synopsis.file):runner.result(session,step,current)??entry?.resultText??(step===1?topicResult(current):null);
 const result=stageResult(session,step,current,entry,text);
 if(!text&&!result.files.length&&entry?.state!=='completed'&&!entry?.note)return null;
 return {current,entry,result,revision:synopsis?.revision};
}

function prepareStageResult(session,stateDir,step){
 const data=resultData(session,stateDir,step);
 if(!data)return null;
 if(!data.result.project&&!isInside(base,fs.realpathSync(stateDir)))throw Error('현재 채팅의 결과 저장 위치를 확인해 주세요.');
 return {...data,documents:prepareResultTxt({sessionDir:stateDir,step,...data})};
}

function publicResult(data,step){
 const {text,files,folder,project}=data.result;
 let bodyCharacters;
 if(step===3){
  const source=files.find(file=>/대본[^/]*\.md$/i.test(file.path))??files.find(file=>/대본[^/]*\.txt$/i.test(file.path));
  const body=(source?readText(path.join(project,source.path)):text)?.match(/(?:^|\n)#{1,6}[ \t]+본편[ \t]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}[ \t]+마무리|$)/)?.[1];
  if(body)bodyCharacters=body.replace(/\r\n/g,'\n').split(/^#{1,6}[^\n]*\n/gm).map(part=>part.trim()).filter(Boolean).join('\n\n').length;
 }
 return {text,files,folder,bodyCharacters,revision:data.revision,txt:data.documents.map(({id,name})=>({id,name}))};
}
function openResultInExplorer(current,result,selection){
 const selected=selection==null?result.folder:result.files.find(file=>file.path===selection)?.path;
 if(!selected)throw Error('현재 결과에서 열 수 있는 파일이나 폴더를 선택해 주세요.');
 if(process.platform!=='win32')throw Error('저장 위치 열기는 Windows에서 사용할 수 있습니다.');
 const target=path.resolve(current.projectPath,selected);
 const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$folder=$env:YADAM_RESULT_FOLDER
$file=$env:YADAM_RESULT_FILE
$explorer=New-Object -ComObject Shell.Application
$explorer.Explore($folder)
for($attempt=0;$attempt -lt 25;$attempt++){
 foreach($window in $explorer.Windows()){
  try{
   $view=$window.Document
   if([string]$view.Folder.Self.Path -ine $folder){continue}
   if($file){
    $item=$view.Folder.ParseName($file)
    if(!$item){continue}
    $view.SelectItem($item,29)
    if(!(@($view.SelectedItems() | ForEach-Object { [IO.Path]::GetFileName($_.Path) }) -icontains $file)){continue}
   }
   exit 0
  }catch{}
 }
 Start-Sleep -Milliseconds 160
}
exit 1`;
 const env={...process.env,YADAM_RESULT_FOLDER:selection==null?target:path.dirname(target),
  YADAM_RESULT_FILE:selection==null?'':path.basename(target)};
 return new Promise((resolve,reject)=>{
  execFile(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],
   {env,windowsHide:true,timeout:8000},error=>{
    if(error)reject(Error('Windows에서 파일 탐색기 창을 열지 못했습니다.'));
    else resolve();
   });
 });
}
function findSynopsis(session,current,entry){
 if(!session||!path.isAbsolute(current.projectPath??'')||(current.dashboardSession&&current.dashboardSession!==session))return null;
 const selected=synopsisPath(current,entry)??(wasReset(2,current)?stageResult(session,2,current,entry,runner.result(session,2,current)).files.find(file=>file.path.endsWith('.md'))?.path:null);
 if(!selected)return null;
 const file=path.resolve(current.projectPath,selected);
 if(!isInside(current.projectPath,file))return null;
 try{
  const workspace=fs.realpathSync(workspaceRoot);
  const resolved=fs.realpathSync(file);
  if(path.relative(file,resolved))return null;
  const inWorkFolder=['야담작업','❤️야담작업'].some(folder=>{
   const relative=path.relative(path.join(workspace,folder),resolved);
   return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
  });
  if(!inWorkFolder)return null;
  const stat=fs.statSync(resolved);
  if(!stat.isFile()||stat.size===0)return null;
  return {file:resolved,revision:`${stat.mtimeMs}:${stat.size}`};
 }catch(error){
  if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))return null;
  throw error;
 }
}
function updateTopicChoice(session,stateDir,input,showNext){
 if(!session)throw Error('현재 채팅을 확인해 주세요.');
 const currentPath=path.join(stateDir,'current-work.json');
 const current=read(currentPath);
 const selection=current.topicSelection;
 if(current.dashboardSession!==session||current.projectPath||current.step!==1||current.status!=='awaiting_input'||!selection||selection.submittedAt){
  throw Error('저장할 선택이 없습니다. 현황표를 새로고침해 주세요.');
 }
 if(showNext){
  const batchNumber=selection.batchNumber??0;
  if(batchNumber!==input.batchNumber)throw Error('이미 후보가 바뀌었습니다. 화면을 확인해 주세요.');
  const [nextBatch,...remaining]=selection.alternativeBatches??[];
  if(current.topic||!nextBatch?.length)throw Error('준비된 다음 후보가 없습니다.');
  const seen=new Set([...(selection.seenTitles??[]),...selection.candidates.map(item=>item.title)]);
  selection.seenTitles=[...seen];
  selection.candidates=nextBatch;
  selection.alternativeBatches=remaining;
  selection.batchNumber=batchNumber+1;
 }else{
  const candidate=selection.candidates?.find(item=>item.number===input.candidateNumber&&item.title===input.candidateTitle);
  if(!current.topic&&!candidate)throw Error('현재 목록에서 주제를 하나 골라 주세요.');
  if(!current.duration&&!selection.durationOptions?.includes(input.duration))throw Error('영상 길이를 하나 골라 주세요.');
  current.topic ||= candidate.title;
  current.duration ||= input.duration;
  selection.submittedAt=new Date().toISOString();
  if(candidate)selection.selectedCandidateNumber=candidate.number;
  current.step=2;
  current.status='ready';
  current.nextInput='2단계 시놉시스 준비';
  const stepsPath=path.join(stateDir,'steps.json');
  const steps=read(stepsPath);
  steps['1']={...steps['1'],state:'completed',completedAt:selection.submittedAt};
  const stepsTemp=stepsPath+'.topic-choice.tmp';
  const currentTemp=currentPath+'.topic-choice.tmp';
  fs.writeFileSync(stepsTemp,JSON.stringify(steps,null,2)+'\n');
  fs.writeFileSync(currentTemp,JSON.stringify(current,null,2)+'\n');
  fs.renameSync(currentTemp,currentPath);
  fs.renameSync(stepsTemp,stepsPath);
  return current;
 }
 const temp=currentPath+'.topic-choice.tmp';
 fs.writeFileSync(temp,JSON.stringify(current,null,2)+'\n');
 fs.renameSync(temp,currentPath);
 return current;
}
http.createServer(async(req,res)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return reply(res,403,{error:'Local access only'});
 const url=new URL(req.url,`http://127.0.0.1:${port}`);const route=url.pathname;
 if(route==='/api/health')return reply(res,200,{service:'lala-yadam-dashboard',version:2,workflowOrderVersion:3,sceneImageReview:true,sceneImageReviewChoice:true,usageNoticeVersion:1,projectReset:true,dubbingRestart:true,stageRestart:true,topicChoice:true,topicChoiceVersion:3,synopsisReader:true,stageRunner:true,stageActivityVersion:1,resultFileLinks:true,resultFileOpenVersion:3,resultTxtVersion:3,stageRunnerAvailable:runner.snapshot(null,{}).available,pid:process.pid,root});
 const session=url.searchParams.get('session');
 if(session!==null&&!/^[a-zA-Z0-9_-]{1,96}$/.test(session))return reply(res,400,{error:'Invalid session'});
 const stateDir=session?path.join(base,'sessions',session):base;
 const topicChoiceRoute=route==='/api/topic-choice'||route==='/api/topic-choice/next';
 const resultTxtRoute=route==='/api/steps/result/txt';
 const restartRoute=route==='/api/steps/restart'||route==='/api/steps/restart-dubbing';
 if(route==='/api/channel'||route==='/api/cleanup/preview'||route==='/api/cleanup/execute'||route==='/api/project/close'||route==='/api/project/reset'||route==='/api/steps/complete'||route==='/api/steps/run'||route==='/api/steps/result/open'||resultTxtRoute||restartRoute||route==='/api/image-review/decision'||topicChoiceRoute){
  if(req.method!=='POST')return reply(res,405,{error:'POST only'});
  if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json'))return reply(res,403,{error:'현황표에서 직접 실행해 주세요.'});
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Error('요청이 너무 큽니다.');}
   const input=JSON.parse(body||'{}');
   if(resultTxtRoute){
    const {step,id,expectedProjectPath,resetAt}=input;
    if(!session||!Number.isInteger(step)||step<1||step>13||typeof id!=='string')throw Error('확인할 TXT 결과를 선택해 주세요.');
    const current=read(path.join(stateDir,'current-work.json'));
    if(current.dashboardSession!==session||(current.projectPath??null)!==expectedProjectPath||(current.resetAt??null)!==resetAt)throw Error('현재 작품의 결과를 다시 열어 주세요.');
    const document=prepareStageResult(session,stateDir,step)?.documents.find(file=>file.id===id);
    if(!document)throw Error('선택한 TXT를 찾을 수 없습니다.');
    const text=readText(document.path);
    const prompt=resultTxtPrompt(document);
    const preview={text,prompt};
    if(sendingTxt.has(session))return reply(res,200,{...preview,queued:false,notice:'앞서 누른 TXT를 채팅에 보내고 있습니다.'});
    sendingTxt.add(session);
    try {
     const resumed=await queueResultTxt(cli,workspaceRoot,session,prompt);
     if(resumed===null)return reply(res,200,{...preview,queued:false,notice:'이 채팅에서 보려면 아래의 요청을 복사해 채팅에 붙여 넣고 보내세요.'});
     return reply(res,200,{...preview,queued:true,resumed});
    }catch(error){
     console.warn('Could not queue dashboard TXT:',error.code??error.message);
     return reply(res,200,{...preview,queued:false,notice:'채팅으로 바로 보내지 못했습니다. 아래의 요청을 복사해 채팅에 붙여 넣고 보내세요.'});
    }finally{sendingTxt.delete(session);}
   }
   if(route==='/api/steps/result/open'){
    const current=read(path.join(stateDir,'current-work.json'));
    const {step,file,expectedProjectPath}=input;
    if(!session||!Number.isInteger(step)||step<1||step>13||current.projectPath!==expectedProjectPath)throw Error('현재 작품의 결과를 다시 열어 주세요.');
    const result=resultData(session,stateDir,step)?.result;
    if(!result)throw Error('현재 단계의 결과가 없습니다.');
    await openResultInExplorer(current,result,file);
    return reply(res,200,{opened:true,verified:true});
   }
   if(route==='/api/steps/run'){
    if(!session)throw Error('현재 채팅의 현황표를 열어 주세요.');
    const current=read(path.join(stateDir,'current-work.json'));
    const steps=read(path.join(stateDir,'steps.json'));
    const review=reviewImages(stateDir,current,steps);
    return reply(res,202,runner.start(session,input,review.required??[]));
   }
   if(route!=='/api/channel')runner.ensureIdle(session);
   if(restartRoute){
    if(!session)throw Error('현재 채팅의 현황표를 열어 주세요.');
    const current=read(path.join(stateDir,'current-work.json'));
    runner.ensureProjectIdle(current.projectPath);
    const step=route==='/api/steps/restart-dubbing'?4:input.step;
    const carryFields=Object.keys(resultFields).filter(number=>Number(number)<step)
     .flatMap(number=>[...resultFields[number],...(stageMetadata[number]??[])]);
    return reply(res,200,cleanup.restartStage(session,{...input,step},{carryFields}));
   }
  if(topicChoiceRoute){
    const current=updateTopicChoice(session,stateDir,input,route.endsWith('/next'));
    try{prepareStageResult(session,stateDir,1);}catch(error){console.warn('Could not prepare topic TXT:',error.message);}
    return reply(res,200,{current});
   }
   if(route==='/api/project/reset')return reply(res,200,cleanup.resetProject(session,input.expectedProjectPath));
   if(route==='/api/image-review/decision'){
    if(!session)throw Error('현재 채팅을 확인해 주세요.');
    const current=read(path.join(stateDir,'current-work.json'));
    if(!current.projectPath||input.expectedProjectPath!==current.projectPath)throw Error('현재 작품이 변경됐어요. 현황표를 새로고침해 주세요.');
    const imageReview=reviewImages(stateDir,current,read(path.join(stateDir,'steps.json')),input);
    if(imageReview.decision!==input.decision)throw Error('새 장면 이미지 안내를 확인해 주세요.');
    return reply(res,200,{imageReview});
   }
   if(route==='/api/channel'){
    const channelName=typeof input?.channelName==='string'?input.channelName.trim():'';
    if(!channelName||channelName.length>80||/[\u0000-\u001f\u007f]/.test(channelName))return reply(res,400,{error:'채널명을 한 줄로 80자 이내에서 입력해 주세요.'});
    const temp=profilePath+'.tmp';
    fs.writeFileSync(temp,JSON.stringify({channelName},null,2)+'\n');
    fs.renameSync(temp,profilePath);
    return reply(res,200,{channelName});
   }
   if(route==='/api/steps/complete'){
    const completed=cleanup.completeStage(session,input.expectedProjectPath,input.step);
    try{prepareStageResult(session,stateDir,input.step);}catch(error){console.warn('Could not prepare completed-stage TXT:',error.message);}
    return reply(res,200,completed);
   }
   return reply(res,200,route==='/api/project/close'?cleanup.closeProject(session,input.expectedProjectPath):route.endsWith('/preview')?cleanup.preview(session):await cleanup.execute(session,input.token));
  }catch(error){return reply(res,409,{error:error.message});}
 }
 if(req.method!=='GET')return reply(res,405,{error:'GET only'});
 try{
  if(route==='/api/snapshot'){
   const steps=read(path.join(stateDir,'steps.json'));
   const current=read(path.join(stateDir,'current-work.json'));
   const imageReview=session?reviewImages(stateDir,current,steps):{};
   const synopsisRevision=findSynopsis(session,current,steps[2])?.revision??null;
   const resultSteps=Array.from({length:13},(_,index)=>index+1).filter(step=>{
    if(!session||current.dashboardSession!==session)return false;
    const entry=steps[step];
    if(step===1&&current.topic)return true;
    if((step===2&&synopsisRevision)||entry?.state==='completed'||entry?.resultText?.trim())return true;
    if(!entry?.resultFiles?.length)return false;
    try{return stageResult(session,step,current,steps[step],null).files.length>0;}catch{return false;}
   });
   return reply(res,200,{session,steps,current,imageReview,synopsisRevision,resultSteps,stageResetOnly:true,runner:runner.snapshot(session,current),channelName:read(profilePath).channelName||''});
  }
  if(route==='/api/steps/result'){
   const step=Number(url.searchParams.get('step'));
   if(!session||!Number.isInteger(step)||step<1||step>13)return reply(res,400,{error:'확인할 단계를 선택해 주세요.'});
   const data=prepareStageResult(session,stateDir,step);
   return data?reply(res,200,publicResult(data,step)):reply(res,404,{error:'아직 저장된 작업 결과가 없습니다.'});
  }
  if(route==='/api/synopsis'){
   const data=prepareStageResult(session,stateDir,2);
   if(!data?.revision)return reply(res,404,{error:'현재 작품에서 저장된 시놉시스를 찾을 수 없습니다.'});
   return reply(res,200,publicResult(data));
  }
  if(route==='/api/status')return reply(res,200,read(path.join(stateDir,'steps.json')));
  if(route==='/api/current')return reply(res,200,read(path.join(stateDir,'current-work.json')));
 }catch{return reply(res,503,{error:'상태를 읽는 중입니다. 잠시 후 갱신합니다.'})}
 const name=route==='/'?'index.html':route.slice(1);
 if(!['index.html','app.js','style.css'].includes(name))return reply(res,404,{error:'Not found'});
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
 res.writeHead(200,{'Content-Type':types[path.extname(name)]+';charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 fs.createReadStream(path.join(root,'dist',name)).on('error',()=>res.end()).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`LALA 야담제작 진행현황표 77: http://127.0.0.1:${port}`));
