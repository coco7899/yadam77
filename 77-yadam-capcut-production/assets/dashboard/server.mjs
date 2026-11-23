import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCleanup} from './cleanup.mjs';
import {createSceneImageReview} from './scene-image-review.mjs';
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
const profilePath=path.join(base,'channel-profile.json');
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
function reply(res,code,data){res.writeHead(code,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
http.createServer(async(req,res)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return reply(res,403,{error:'Local access only'});
 const url=new URL(req.url,`http://127.0.0.1:${port}`);const route=url.pathname;
 if(route==='/api/health')return reply(res,200,{service:'lala-yadam-dashboard',version:2,workflowOrderVersion:3,sceneImageReview:true,sceneImageReviewChoice:true,usageNoticeVersion:1,pid:process.pid,root});
 const session=url.searchParams.get('session');
 if(session!==null&&!/^[a-zA-Z0-9_-]{1,96}$/.test(session))return reply(res,400,{error:'Invalid session'});
 const stateDir=session?path.join(base,'sessions',session):base;
 if(route==='/api/channel'||route==='/api/cleanup/preview'||route==='/api/cleanup/execute'||route==='/api/project/close'||route==='/api/steps/complete'||route==='/api/image-review/decision'){
  if(req.method!=='POST')return reply(res,405,{error:'POST only'});
  if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json'))return reply(res,403,{error:'현황표에서 직접 실행해 주세요.'});
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Error('요청이 너무 큽니다.');}
   const input=JSON.parse(body||'{}');
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
   return reply(res,200,{session,steps,current,imageReview,channelName:read(profilePath).channelName||''});
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
