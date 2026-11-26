import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCleanup} from './cleanup.mjs';
import {createSceneImageReview} from './scene-image-review.mjs';
import {createStageRunner} from './stage-runner.mjs';
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
const runner=createStageRunner({
 stateBase:base,workspaceRoot,skillRoot:process.env.YADAM_SKILL_ROOT,
 cli:process.env.YADAM_CODEX_CLI||process.env.CODEX_APP_RUNTIME_CLI_PATH
});
const profilePath=path.join(base,'channel-profile.json');
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
function reply(res,code,data){res.writeHead(code,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function findSynopsis(session,current){
 if(!session||!path.isAbsolute(current.projectPath??'')||(current.dashboardSession&&current.dashboardSession!==session))return null;
 const file=path.join(current.projectPath,'제작관리','시놉시스.md');
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
 if(route==='/api/health')return reply(res,200,{service:'lala-yadam-dashboard',version:2,workflowOrderVersion:3,sceneImageReview:true,sceneImageReviewChoice:true,usageNoticeVersion:1,projectReset:true,topicChoice:true,topicChoiceVersion:3,synopsisReader:true,stageRunner:true,stageRunnerAvailable:runner.snapshot(null,{}).available,pid:process.pid,root});
 const session=url.searchParams.get('session');
 if(session!==null&&!/^[a-zA-Z0-9_-]{1,96}$/.test(session))return reply(res,400,{error:'Invalid session'});
 const stateDir=session?path.join(base,'sessions',session):base;
 const topicChoiceRoute=route==='/api/topic-choice'||route==='/api/topic-choice/next';
 if(route==='/api/channel'||route==='/api/cleanup/preview'||route==='/api/cleanup/execute'||route==='/api/project/close'||route==='/api/project/reset'||route==='/api/steps/complete'||route==='/api/steps/run'||route==='/api/image-review/decision'||topicChoiceRoute){
  if(req.method!=='POST')return reply(res,405,{error:'POST only'});
  if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json'))return reply(res,403,{error:'현황표에서 직접 실행해 주세요.'});
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Error('요청이 너무 큽니다.');}
   const input=JSON.parse(body||'{}');
   if(route==='/api/steps/run'){
    if(!session)throw Error('현재 채팅의 현황표를 열어 주세요.');
    const current=read(path.join(stateDir,'current-work.json'));
    const steps=read(path.join(stateDir,'steps.json'));
    const review=reviewImages(stateDir,current,steps);
    return reply(res,202,runner.start(session,input,review.required??[]));
   }
   if(route!=='/api/channel')runner.ensureIdle(session);
   if(topicChoiceRoute)return reply(res,200,{current:updateTopicChoice(session,stateDir,input,route.endsWith('/next'))});
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
   return reply(res,200,route==='/api/steps/complete'?cleanup.completeStage(session,input.expectedProjectPath,input.step):route==='/api/project/close'?cleanup.closeProject(session,input.expectedProjectPath):route.endsWith('/preview')?cleanup.preview(session):await cleanup.execute(session,input.token));
  }catch(error){return reply(res,409,{error:error.message});}
 }
 if(req.method!=='GET')return reply(res,405,{error:'GET only'});
 try{
  if(route==='/api/snapshot'){
   const steps=read(path.join(stateDir,'steps.json'));
   const current=read(path.join(stateDir,'current-work.json'));
   const imageReview=session?reviewImages(stateDir,current,steps):{};
   const synopsisRevision=findSynopsis(session,current)?.revision??null;
   return reply(res,200,{session,steps,current,imageReview,synopsisRevision,runner:runner.snapshot(session,current),channelName:read(profilePath).channelName||''});
  }
  if(route==='/api/steps/result'){
   const step=Number(url.searchParams.get('step'));
   if(!session||!Number.isInteger(step)||step<1||step>13)return reply(res,400,{error:'확인할 단계를 선택해 주세요.'});
   const result=runner.result(session,step,read(path.join(stateDir,'current-work.json')));
   return result?reply(res,200,{text:result}):reply(res,404,{error:'아직 저장된 작업 결과가 없습니다.'});
  }
  if(route==='/api/synopsis'){
   const synopsis=findSynopsis(session,read(path.join(stateDir,'current-work.json')));
   if(!synopsis)return reply(res,404,{error:'현재 작품에서 저장된 시놉시스를 찾을 수 없습니다.'});
   return reply(res,200,{revision:synopsis.revision,text:fs.readFileSync(synopsis.file,'utf8').replace(/^\uFEFF/,'')});
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
