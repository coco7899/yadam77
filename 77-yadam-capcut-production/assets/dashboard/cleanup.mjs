import {destination,requiredFolders,directoryMoves} from './project-layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const protectedNames = new Set(['.git','.codex','.agents','.aws','node_modules']);
const textTypes = new Set(['.md','.json','.txt','.csv']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const slash = value => value.replaceAll('\\','/');
const fail = message => { throw new Error(message); };
const within = (base,file) => {const rel=path.relative(base,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const atomic = (file,content) => {
  const temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try {fs.writeFileSync(temp,content,{flag:'wx'});fs.renameSync(temp,file);}
  finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
};

function inventory(root) {
  const files=[];
  function walk(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      if(protectedNames.has(item.name.toLowerCase()))continue;
      const file=path.join(dir,item.name), stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())fail('연결 폴더 또는 링크가 있습니다. 해당 경로를 확인한 후 정리해 주세요.');
      if(stat.isDirectory())walk(file);
      else if(stat.isFile())files.push({file,relative:slash(path.relative(root,file)),size:stat.size,mtime:stat.mtimeMs,ino:stat.ino});
    }
  }
  walk(root);return files.sort((a,b)=>a.relative.localeCompare(b.relative));
}

function rewrite(text,oldFile,newFile,root,moves) {
  const replaceAbsolute=value=>{
    for(const move of moves) {
      const old=path.join(root,move.from), next=path.join(root,move.to);
      for(const [a,b] of [[old,next],[slash(old),slash(next)],[old.replaceAll('\\','\\\\'),next.replaceAll('\\','\\\\')]])value=value.replaceAll(a,(match,offset,whole)=>{
        const suffix=whole.slice(offset+a.length);
        return move.directory&&/^[\/\\]/.test(suffix)?b:/^[\/\\\p{L}\p{N}_-]/u.test(suffix)||/^\.[\p{L}\p{N}_]/u.test(suffix)?match:b;
      });
    }
    return value;
  };
  const mapped=file=>{const m=moves.find(m=>path.join(root,m.from)===file||m.directory&&file.startsWith(path.join(root,m.from)+path.sep));return m?path.join(root,m.to)+file.slice(path.join(root,m.from).length):file;};
  function reference(value) {
    if(!value||/^[a-z]+:\/\//i.test(value)||value.startsWith('#'))return replaceAbsolute(value);
    const parts=value.match(/^([^#]*)(#.*)?$/),target=parts[1],anchor=parts[2]||'';
    if(path.isAbsolute(target))return replaceAbsolute(value);
    const normalized=target.replace(/[\\/]/g,path.sep);
    // Data paths are project-relative; Markdown links are relative to their document.
    const candidate=path.resolve(path.dirname(oldFile),normalized);
    if(within(root,candidate)&&fs.existsSync(candidate))return slash(path.relative(path.dirname(newFile),mapped(candidate)))+anchor;
    const projectCandidate=path.resolve(root,normalized);
    const move=moves.find(m=>path.join(root,m.from)===projectCandidate);
    return move?move.to+anchor:replaceAbsolute(value);
  }
  if(path.extname(oldFile).toLowerCase()==='.json') {
    const visit=(value,key='')=>{
      if(typeof value==='string') {
        if(/^(file_?name|original_?(file_?)?name|title|label)$/i.test(key))return value;
        if(path.isAbsolute(value)||value.includes(root)||value.includes(slash(root)))return replaceAbsolute(value);
        const m=moves.find(m=>slash(value).replace(/^\.\//,'')===m.from);return m?m.to:replaceAbsolute(value);
      }
      if(Array.isArray(value))return value.map(item=>visit(item,key));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,k)]));
      return value;
    };
    const original=JSON.parse(text.replace(/^\uFEFF/,'')), next=visit(original);
    return JSON.stringify(original)===JSON.stringify(next)?text:JSON.stringify(next,null,2)+'\n';
  }
  // Resolve Markdown links before replacing paths, including links to unmoved assets
  // in a moved document. Plain code paths remain relative to the project root.
  const links=[];
  text=text.replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\n]+)(\))/g,(all,start,target,end)=>{
    const angle=target.startsWith('<');const value=angle?target.slice(1,-1):target;
    links.push(start+(angle?'<':'')+reference(value)+(angle?'>':'')+end);
    return '\u0000'+(links.length-1)+'\u0000';
  });
  text=replaceAbsolute(text);
  for(const move of moves) {
    text=text.replaceAll(move.from,(match,offset,whole)=>{
      const before=whole[offset-1]||'',suffix=whole.slice(offset+match.length);
      if(/[\/\\\p{L}\p{N}_-]/u.test(before)||/^[\/\\\p{L}\p{N}_-]/u.test(suffix)||/^\.[\p{L}\p{N}_]/u.test(suffix))return match;
      return move.to;
    });
  }
  return text.replace(/\u0000(\d+)\u0000/g,(_,index)=>links[Number(index)]);
}

export function recycleWindows(files) {
  if(!files.length)return Promise.resolve();
  if(process.platform!=='win32')return Promise.reject(new Error('휴지통 기능은 Windows에서만 실행할 수 있습니다.'));
  return new Promise((resolve,reject)=>{
    const script="$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName Microsoft.VisualBasic; $items=([Console]::In.ReadToEnd() | ConvertFrom-Json); foreach($item in $items){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile([string]$item,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)}";
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let error='';child.stderr.on('data',d=>{error+=d});child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error('휴지통 이동 실패: '+error.slice(-1200))));
    child.stdin.end(JSON.stringify(files));
  });
}

export function createCleanup({stateBase,allowedRoot='D:\\1CODEX\\야담작업',recycle=recycleWindows}) {
  const plans=new Map(),locks=new Set();
  function context(session) {
    if(!/^[a-zA-Z0-9_-]{1,96}$/.test(session||''))fail('현재 채팅이 확인되지 않습니다. 77로 현황표를 다시 열어 주세요.');
    const stateDir=path.join(stateBase,'sessions',session),currentFile=path.join(stateDir,'current-work.json'),stepsFile=path.join(stateDir,'steps.json');
    const current=json(currentFile), steps=json(stepsFile);
    if(!current.projectPath)fail('현재 채팅에서 작품을 먼저 선택해 주세요.');
    const requested=path.resolve(current.projectPath),base=fs.realpathSync(allowedRoot),root=fs.realpathSync(requested);
    if(!within(base,root)||requested.toLowerCase()!==root.toLowerCase())fail('작품 폴더 범위를 벗어나거나 연결 경로입니다. 정리를 중단했습니다.');
    const files=inventory(root);
    const stamp=hash(JSON.stringify({files:files.map(f=>[f.relative,f.size,f.mtime,f.ino]),current:fs.readFileSync(currentFile,'utf8'),steps:fs.readFileSync(stepsFile,'utf8')}));
    return {session,stateDir,currentFile,stepsFile,current,steps,root,files,stamp};
  }
  function build(ctx) {
    const {root,files}=ctx,moves=[],removals=[],preserved=[];
    const texts=files.filter(f=>textTypes.has(path.extname(f.file).toLowerCase())).map(f=>({...f,text:fs.readFileSync(f.file,'utf8')}));
    // Only exact redundant temporary copies or empty unreferenced temporary files
    // are removable. A name containing '수정', '초안' or '이전' alone is no evidence.
    for(const f of files) {
      const name=path.basename(f.file),temp=/\.(?:tmp|part|bak|old)$/i.test(name);
      if(!temp)continue;
      const referenced=texts.some(t=>t.file!==f.file&&t.text.includes(name));
      if(referenced)continue;
      const canonical=f.file.replace(/\.(?:tmp|part|bak|old)$/i,'');
      const counterpart=files.find(x=>x.file===canonical);
      if(f.size===0||counterpart&&counterpart.size===f.size&&hash(fs.readFileSync(f.file))===hash(fs.readFileSync(canonical)))removals.push({path:f.relative,reason:f.size===0?'내용이 없고 참조되지 않는 임시 파일':'현재 파일과 내용이 동일하고 참조되지 않는 임시 사본',size:f.size});
    }
    for(const f of files) {
      const to=destination(f.relative);
      if(to!==f.relative) {
        if(fs.existsSync(path.join(root,to)))fail('같은 이름의 정리 대상이 이미 있습니다: '+to);
        if(moves.some(m=>m.to.toLowerCase()===to.toLowerCase()))fail('이동할 파일 이름이 겹칩니다: '+to);
        moves.push({from:f.relative,to});
      } else if(!f.relative.includes('/'))preserved.push({path:f.relative,reason:'프로젝트 루트의 진행 기록·안내·상태 보존'});
    }
    const updates=[];
    for(const t of texts) {
      if(removals.some(r=>r.path===t.relative))continue;
      const move=moves.find(m=>m.from===t.relative),nextFile=move?path.join(root,move.to):t.file;
      const next=rewrite(t.text,t.file,nextFile,root,[...moves,...directoryMoves]);
      if(next!==t.text)updates.push({from:t.file,file:nextFile,original:t.text,next});
    }
    const pending=Array.from({length:13},(_,i)=>i+1).filter(n=>ctx.steps[n]?.state!=='completed');
    return {moves,removals,preserved,updates,pending};
  }
  function preview(session) {
    const ctx=context(session);if(locks.has(ctx.root))fail('이 작품의 폴더를 정리하고 있습니다.');
    const plan=build(ctx),token=crypto.randomBytes(24).toString('hex');
    for(const [k,v] of plans)if(v.expires<Date.now())plans.delete(k);
    if(plans.size>=20)plans.delete(plans.keys().next().value);
    plans.set(token,{session,stamp:ctx.stamp,expires:Date.now()+10*60*1000});
    return {token,projectPath:ctx.root,topic:ctx.current.topic,...{moves:plan.moves,removals:plan.removals,preserved:plan.preserved,pending:plan.pending},referenceUpdates:plan.updates.length,canFinish:plan.pending.length===0,note:'지정한 6개 제작 폴더와 제작관리 폴더로 정리하고 참조 경로를 갱신합니다. MD·JSON과 모든 원본을 보존합니다. 삭제 후보는 확인만 하며 파일을 삭제하지 않습니다.'};
  }
  async function execute(session,token) {
    const saved=plans.get(token);
    if(!saved||saved.session!==session||saved.expires<Date.now())fail('정리 미리보기가 만료되었습니다. 대상을 다시 확인해 주세요.');
    const ctx=context(session);
    if(saved.stamp!==ctx.stamp)fail('미리보기 이후 파일이나 진행 상태가 변경되었습니다. 정리 대상을 다시 확인해 주세요.');
    if(locks.has(ctx.root))fail('이 작품의 폴더를 정리하고 있습니다.');
    const plan=build(ctx);plans.delete(token);locks.add(ctx.root);
    const moved=[],written=[],createdDirs=[],stateOriginal=fs.readFileSync(ctx.currentFile),reportFile=path.join(ctx.root,'프로젝트안내.md');
    const reportOriginal=fs.existsSync(reportFile)?fs.readFileSync(reportFile):null;
    const recordFile=path.join(ctx.root,'00_제작진행.md');
    const recordOriginal=fs.existsSync(recordFile)?fs.readFileSync(recordFile):null;
    const snapshotFile=path.join(ctx.root,'현황표상태.json'),snapshotOriginal=fs.existsSync(snapshotFile)?fs.readFileSync(snapshotFile):null;
    let recycled=false;
    try {
      for(const m of plan.moves) {
        const from=path.join(ctx.root,m.from),to=path.join(ctx.root,m.to),dir=path.dirname(to);
        if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});createdDirs.push(dir);}
        fs.renameSync(from,to);moved.push({from,to});
      }
      for(const u of plan.updates){atomic(u.file,u.next);written.push(u);}
      // Recycle last, after reversible moves and reference edits succeed. Never
      // fall back to permanent deletion if Windows cannot use the Recycle Bin.
      // Current user instruction: audit deletions only. Do not delete or recycle.
      for(const folder of requiredFolders)fs.mkdirSync(path.join(ctx.root,folder),{recursive:true});
      const at=new Date().toISOString(),finished=plan.pending.length===0;
      const summary={at,moved:plan.moves.length,recycled:0,deletionCandidates:plan.removals.length,layoutVersion:3,referenceUpdates:plan.updates.length,finished,pending:plan.pending};
      const mapPath=value=>{if(typeof value==='string')for(const m of moved)value=value.split(m.from).join(m.to).split(slash(m.from)).join(slash(m.to));return value;};
      const next=Object.fromEntries(Object.entries(ctx.current).map(([k,v])=>[k,mapPath(v)]));
      next.folderCleanup=summary;next.projectStatus=finished?'finished':'in_progress';
      if(ctx.current.projectStatus==='closed'&&!finished){next.status='awaiting_input';next.resumedAt=at;next.nextInput='같은 작품의 추가 작업을 채팅에서 이어가세요.';}
      if(finished){next.status='completed';next.nextInput='최종 폴더 정리 완료 · 프로젝트 마무리';}
      atomic(ctx.currentFile,JSON.stringify(next,null,2)+'\n');
      atomic(snapshotFile,JSON.stringify({steps:ctx.steps,currentWork:next,chatId:session},null,2)+'\n');
      const status=finished?'프로젝트 마무리 완료':'폴더 정리 완료 · 미완료 단계 유지';
      const lines=['# 프로젝트 파일 안내','',`작품: ${ctx.current.topic||path.basename(ctx.root)}`,`정리 시각: ${new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`,`상태: ${status}`,'',`작품 폴더: \`${ctx.root}\``,'','- 더빙원고/본문종합, 분할더빙원고','- 이미지폴더/캐릭터, 에셋, 장면, 스타일참조, 제공원본','- 인트로영상/인트로이미지, 인트로영상, 제작자료','- 오디오자막소스/SRT, MP3','- 본편최종결과/: 본편 영상·검수·CapCut인계','- 유튜브업로드/: 썸네일·제목·설명·태그','- 제작관리/: 시놉시스·기획·기타 MD·JSON','',`파일 이동 ${summary.moved}개 · 참조 갱신 ${summary.referenceUpdates}개 · 삭제 0개`,'','MD·JSON 및 모든 원본을 보존했습니다. 삭제 후보는 확인만 합니다. PC CapCut의 기존 로컬 원본을 다시 연결할 때는 위의 새 음원·장면 폴더를 선택하세요.'];
      if(plan.pending.length)lines.push('',`미완료 단계: ${plan.pending.join(', ')}. 실제 제작·검증 후 현황을 갱신해 주세요.`);
      if(plan.moves.length)lines.push('','## 이번 정리',...plan.moves.map(m=>`- \`${m.from}\` → \`${m.to}\``));
      if(plan.removals.length)lines.push('','## 삭제 후보 — 삭제하지 않음',...plan.removals.map(r=>`- \`${r.path}\`: ${r.reason}`));
      atomic(reportFile,lines.join('\n')+'\n');
      if(recordOriginal){const marker='\n<!-- folder-cleanup -->';const existing=fs.readFileSync(recordFile,'utf8').split(marker)[0];atomic(recordFile,existing+marker+'\n\n## 최종 폴더 정리\n\n'+status+`\n\n[프로젝트 파일 안내](프로젝트안내.md) · 이동 ${summary.moved}개 · 휴지통 ${summary.recycled}개\n`);}
      return {...summary,message:status,reportPath:reportFile};
    } catch(error) {
      // Restore paths and text on failure. A partial Recycle Bin operation is
      // recoverable there; never claim completion or re-delete blindly.
      for(const u of written.reverse())atomic(u.file,u.original);
      for(const m of moved.reverse())if(fs.existsSync(m.to))fs.renameSync(m.to,m.from);
      atomic(ctx.currentFile,stateOriginal);
      for(const [file,original] of [[reportFile,reportOriginal],[recordFile,recordOriginal],[snapshotFile,snapshotOriginal]]){if(original)atomic(file,original);else if(fs.existsSync(file))fs.unlinkSync(file);}
      for(const dir of createdDirs.reverse())if(fs.existsSync(dir)&&fs.readdirSync(dir).length===0)fs.rmdirSync(dir);
      throw new Error(error.message+(plan.removals.length?' 휴지통으로 이미 이동된 임시 파일이 있다면 휴지통에서 복원할 수 있습니다.':'')+(recycled?' 프로젝트 완료 기록은 저장하지 않았습니다.':''));
    } finally {locks.delete(ctx.root);}
  }
  function closeProject(session,expectedProjectPath) {
    const ctx=context(session);
    if(expectedProjectPath!==ctx.current.projectPath)fail('현재 작품이 변경되었습니다. 현황표를 새로고침해 주세요.');
    if(locks.has(ctx.root))fail('폴더 정리가 끝난 후 프로젝트를 종료해 주세요.');
    const message='100만유튜버 화이팅!! 새채팅에서 프로젝트를 시작해주세요';
    if(ctx.current.projectStatus==='closed')return {closed:true,message,closedAt:ctx.current.closedAt};
    const at=new Date().toISOString();
    const current={...ctx.current,projectStatus:'closed',status:'closed',closedAt:at,closedBy:'user',nextInput:message};
    // Closing is the user's project-level decision, not evidence that each
    // externally produced intro or production stage was verified here.
    const snapshot=path.join(ctx.root,'현황표상태.json'),record=path.join(ctx.root,'00_제작진행.md');
    const targets=[ctx.currentFile,snapshot,record];
    const originals=targets.map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]);
    try {
      atomic(ctx.currentFile,JSON.stringify(current,null,2)+'\n');
      atomic(snapshot,JSON.stringify({steps:ctx.steps,currentWork:current,chatId:session},null,2)+'\n');
      const text=fs.existsSync(record)?fs.readFileSync(record,'utf8'):'종료 작품: '+ctx.current.topic+'\n';
      atomic(record,text+'\n\n## 사용자 프로젝트 종료\n\n'+new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' 사용자 종료 버튼으로 마무리했습니다. 외부 CapCut에서 진행한 작업의 개별 단계 검증 상태는 유지합니다.\n\n'+message+'\n');
    } catch(error) {
      for(const [file,original] of originals){if(original)atomic(file,original);else if(fs.existsSync(file))fs.unlinkSync(file);}
      throw error;
    }
    return {closed:true,message,closedAt:at};
  }
  function completeStage(session,expectedProjectPath,step) {
    if(![10,11,12].includes(step))fail('사용자 완료 버튼은 10~12단계에만 사용할 수 있습니다.');
    const ctx=context(session);
    if(expectedProjectPath!==ctx.current.projectPath)fail('현재 작품이 변경되었습니다. 현황표를 새로고침해 주세요.');
    if(locks.has(ctx.root))fail('폴더 정리가 끝난 후 완료를 표시해 주세요.');
    if(ctx.current.workflowOrderVersion!==3)fail('77로 현황표를 다시 열어 단계 순서를 갱신해 주세요.');
    if(ctx.steps[step]?.state==='completed')return {completed:true,step};
    const at=new Date().toISOString(),steps={...ctx.steps,[step]:{...ctx.steps[step],state:'completed',completionSource:'user',completedAt:at}};
    const pending=Array.from({length:13},(_,i)=>i+1).filter(n=>steps[n]?.state!=='completed');
    const current={...ctx.current,projectStatus:pending.length?'in_progress':'finished',status:pending.length?'awaiting_input':'completed',step:pending[0]||13,nextInput:pending.length?`${pending[0]}단계 작업을 채팅에서 이어가세요.`:'제작 단계 완료 · 폴더 정리 또는 프로젝트 종료를 선택하세요.'};
    if(ctx.current.projectStatus==='closed')current.resumedAt=at;
    const snapshot=path.join(ctx.root,'현황표상태.json'),record=path.join(ctx.root,'00_제작진행.md');
    const originals=[ctx.currentFile,ctx.stepsFile,snapshot,record].map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]);
    try {
      atomic(ctx.stepsFile,JSON.stringify(steps,null,2)+'\n');atomic(ctx.currentFile,JSON.stringify(current,null,2)+'\n');
      atomic(snapshot,JSON.stringify({steps,currentWork:current,chatId:session},null,2)+'\n');
      const text=fs.existsSync(record)?fs.readFileSync(record,'utf8'):'';
      atomic(record,text+`\n\n## ${step}단계 사용자 완료 확인\n\n${new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} 사용자가 현황표에서 직접 완료를 표시했습니다.\n`);
    } catch(error){for(const [file,original] of originals){if(original)atomic(file,original);else if(fs.existsSync(file))fs.unlinkSync(file);}throw error;}
    return {completed:true,step,resumed:ctx.current.projectStatus==='closed'};
  }
  return {preview,execute,closeProject,completeStage};
}
