const legacySteps=['주제 선택','시놉시스','대본 작성·두 번 검수','더빙용 원고 확정','스타일·캐릭터·참조 에셋','이미지프롬프트생성\n(SRT,MP3파일제공)','파일 검증·스토리 매칭','이미지 연결표','본편 렌더링·검수','인트로 제작','썸네일·업로드 준비','CapCut으로 보내기'];
const currentSteps=['주제 선택','시놉시스','대본 작성·두 번 검수','더빙용 원고 확정','스타일·캐릭터·참조 에셋','이미지프롬프트생성\n(SRT,MP3파일제공)','파일 검증·스토리 매칭','이미지 연결표','본편 렌더링·검수','CapCut으로 보내기','인트로 제작','썸네일·업로드 준비'];
const expandedSteps=[...currentSteps.slice(0,11),'고정화자 영상제작',currentSteps[11]];
let steps=expandedSteps;
let projectClosed=false,activeProjectPath=null,projectCloseBusy=false;
let stageCompleteBusy=null;
let dashboardRunner={available:false,busy:false,runs:{}};
let dashboardWork={};
let dashboardStartBusy=false;
let dashboardSynopsisRevision=null;
let dashboardStageResetOnly=false;
let openStageResult=null;
const session=new URLSearchParams(location.search).get('session');const query=session?'?session='+encodeURIComponent(session):'';const container=document.getElementById('steps');const cleanupAction=document.getElementById('cleanup-action');let statuses={};let signature='';let fetching=false;
const resetButton=document.getElementById('project-reset');
const resetError=document.getElementById('project-reset-error');
const chatGuide=document.getElementById('chat-guide');
let resetBusy=false;

function canRestartStage(step){
 if(!dashboardStageResetOnly||!session||!signature||resetBusy||dashboardStartBusy||cleanupBusy||projectCloseBusy||stageCompleteBusy!==null||reviewBusy||dashboardRunner.busy)return false;
 if(step===1)return Boolean(activeProjectPath||dashboardWork.topicSelection?.candidates?.length||dashboardWork.topic);
 if(!dashboardWork.topic||!dashboardWork.duration)return false;
 if(step===2)return true;
 return Boolean(activeProjectPath);
}

async function restartStage(step,button){
 if(!canRestartStage(step))return;
 resetBusy=true;
 button.disabled=true;
 notifyStage('');
 try{
  const response=await fetch('/api/steps/restart'+query,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({step,expectedProjectPath:activeProjectPath??null,resetAt:dashboardWork.resetAt??null})
  });
  const result=await response.json();
  if(!response.ok||!result.reset)throw Error(result.error||`${step}단계부터 초기화하지 못했습니다.`);
  notifyStage(`${step}단계부터 초기화했습니다. 준비되면 시작을 누르세요.`);
 }catch(error){
  notifyStage(error.message);
 }finally{
  resetBusy=false;
  signature='';
  await refresh();
 }
}

resetButton.addEventListener('click',async()=>{
 if(!session||resetBusy||cleanupBusy||projectCloseBusy||stageCompleteBusy!==null||reviewBusy||dashboardRunner.busy)return;
 resetBusy=true;
 resetButton.disabled=true;
 resetError.hidden=true;
 try{
  const response=await fetch('/api/project/reset'+query,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({expectedProjectPath:activeProjectPath??null})
  });
  const result=await response.json();
  if(!response.ok||!result.reset)throw Error(result.error||'현황표를 리셋하지 못했습니다.');
  location.reload();
 }catch(error){
  resetError.textContent=error.message;
  resetError.hidden=false;
  resetBusy=false;
  resetButton.disabled=false;
  void refresh();
 }
});

const usageNotice=document.getElementById('usage-notice');
const usageNoticeKey='yadam77.usage-notice.v1';
let usageNoticeSeen=false;
try {
 usageNoticeSeen=localStorage.getItem(usageNoticeKey)==='acknowledged';
}catch{}
usageNotice.addEventListener('cancel',event=>event.preventDefault());
usageNotice.querySelector('form').addEventListener('submit',()=>{
 try {
  localStorage.setItem(usageNoticeKey,'acknowledged');
 }catch{}
});
if(!usageNoticeSeen)usageNotice.showModal();

let imageReview={};
const reviewPrompt=document.getElementById('image-review-prompt');
const reviewScenes=document.getElementById('image-review-scenes');
const reviewError=document.getElementById('image-review-error');
const reviewRestart=document.getElementById('image-review-restart');
const reviewKeep=document.getElementById('image-review-keep');
let reviewBusy=false;
let displayedReview;
function paintReviewPrompt(){
 const pending=imageReview.pending;
 reviewPrompt.hidden=!pending;
 if(displayedReview!==pending?.revision){
  reviewError.hidden=true;
  reviewError.textContent='';
  displayedReview=pending?.revision;
 }
 if(!pending)return;
 const names=pending.scenes.slice(0,8).join(', ');
 const more=pending.scenes.length-8;
 reviewScenes.textContent=names+(more>0?` 외 ${more}컷`:'');
 reviewRestart.disabled=reviewBusy;
 reviewKeep.disabled=reviewBusy;
}
async function chooseImageReview(decision){
 const revision=imageReview.pending?.revision;
 if(!revision||reviewBusy)return;
 reviewBusy=true;
 paintReviewPrompt();
 reviewError.hidden=true;
 try{
  const response=await fetch('/api/image-review/decision'+query,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({revision,decision,expectedProjectPath:activeProjectPath})
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  imageReview=result.imageReview;
  signature='';
  paint();
 }catch(error){
  reviewError.textContent=error.message||'선택을 저장하지 못했어요. 다시 시도해 주세요.';
  reviewError.hidden=false;
 }finally{
  reviewBusy=false;
  paintReviewPrompt();
  void refresh();
 }
}
reviewRestart.addEventListener('click',()=>chooseImageReview('restart'));
reviewKeep.addEventListener('click',()=>chooseImageReview('keep'));

function paint(){
 paintReviewPrompt();
 container.querySelectorAll(':scope > .step').forEach(card=>card.remove());
 const required=new Set(imageReview.required??[]);
 const complete=n=>statuses[n]?.state==='completed'&&!required.has(n);
 const done=steps.filter((_,i)=>complete(i+1)).length;
 document.getElementById('progress').textContent=`${done} / ${steps.length}`;
 document.getElementById('meter').max=steps.length;
 document.getElementById('meter').value=done;
 const restartStep=dashboardWork.restartFromStep&&dashboardWork.step;
 const current=restartStep>=1&&restartStep<=steps.length&&!complete(restartStep)
  ?restartStep-1:steps.findIndex((_,i)=>!complete(i+1));
 const active=current>=0?statuses[current+1]?.state:null;
 document.getElementById('next').textContent=projectClosed
  ?'프로젝트 종료 · 상단 리셋으로 새 이야기 시작'
  :current<0?'모든 단계 완료':`${active==='running'?'현재':'다음'} · ${current+1}단계 ${steps[current]}`;
 steps.forEach((title,index)=>{
  const n=index+1;
  const entry=statuses[n]||{};
  const state=entry.state;
  const review=required.has(n);
  const run=dashboardRunner.runs[n];
  const card=document.createElement('article');
  card.dataset.step=n;
  card.className='step'+(review?' review-required':complete(n)?' done':state==='running'?' running':index===current&&!projectClosed?' next':'');
  const top=document.createElement('div');
  top.className='top';
  const num=document.createElement('span');
  num.textContent=String(n).padStart(2,'0');
  const mark=document.createElement('span');
  mark.className='mark';
  mark.textContent=review?'!':complete(n)?'✓':state==='running'?'…':index===current?'다음':'';
  const numberGroup=document.createElement('span');
  numberGroup.className='step-number-group';
  const restart=document.createElement('button');
  restart.type='button';
  restart.className='stage-restart';
  restart.textContent='★';
  restart.title=dashboardStageResetOnly?'초기화':'현황표 서버를 다시 열면 초기화할 수 있습니다.';
  restart.setAttribute('aria-label',`${n}단계부터 초기화`);
  restart.disabled=!canRestartStage(n);
  restart.addEventListener('click',()=>void restartStage(n,restart));
  numberGroup.append(num,restart);
  top.append(numberGroup,mark);
  const name=document.createElement('h2');
  name.textContent=title;
  if(n===2)name.tabIndex=-1;
  name.style.whiteSpace='pre-line';
  const text=document.createElement('p');
  text.className='state';
  text.textContent=run?.phase==='running'?'Codex 작업 중':run?.phase==='failed'||run?.phase==='interrupted'?'다시 실행할 수 있습니다':
   review
   ?(state==='completed'||entry.previousCompletions?.length?'이전 완료 기록 있음 · 재검수 필요':'재검수 필요')
   :complete(n)?'완료':state==='running'?'작업 중':state==='awaiting_input'?'입력 대기':state==='failed'?'확인이 필요합니다':index===current?'다음 작업':'대기';
  if(review&&imageReview.scenes?.length)text.title='새 장면 이미지: '+imageReview.scenes.join(', ');
  card.append(top,name,text);
  if(!complete(n)){
   const runButton=document.createElement('button');
   runButton.type='button';
   runButton.className='stage-run';
   const running=run?.phase==='running';
   const action=running?'진행 중':run?.phase==='awaiting_input'?'이어서 실행':'시작';
   const label=`${n}단계 ${title.replaceAll('\n',' ')} ${action}`;
   const icon=document.createElement('span');
   icon.className=running?'stage-run-icon is-running':'stage-run-icon';
   icon.setAttribute('aria-hidden','true');
   runButton.setAttribute('aria-label',label);
   runButton.title=label;
   runButton.append(icon);
   runButton.disabled=!canStartDashboardStep(n);
   runButton.addEventListener('click',()=>void startDashboardStage(n));
   card.append(runButton);
  }
  const resultKey=stageResultKey(n);
  if(resultKey){
   const resultButton=document.createElement('button');
   resultButton.type='button';
   resultButton.className='quiet stage-result-toggle';
   resultButton.textContent=openStageResult?.id===resultKey?'접기':'결과 보기';
   resultButton.setAttribute('aria-expanded',String(openStageResult?.id===resultKey));
   resultButton.setAttribute('aria-controls','stage-result-panel');
   resultButton.addEventListener('click',()=>void toggleStageResult(n,resultKey));
   card.append(resultButton);
  }
  if(n>=10&&n<=12){
   const button=document.createElement('button');
   const blocked=review&&n===10&&(required.has(8)||required.has(9));
   button.type='button';
   button.className='stage-complete';
   button.textContent=complete(n)?'완료됨':stageCompleteBusy===n?'저장 중…':'완료';
   button.setAttribute('aria-label',`${n}단계 ${title} ${button.textContent}`);
   button.disabled=!activeProjectPath||complete(n)||blocked||stageCompleteBusy!==null||cleanupBusy||projectCloseBusy||dashboardRunner.busy;
   if(blocked)button.title='새 이미지의 8·9단계 검수 후 CapCut 인계를 완료할 수 있어요.';
   button.addEventListener('click',()=>completeStageFromCard(n));
   card.append(button);
  }
  container.insertBefore(card,cleanupAction);
 });
 if(openStageResult){
  const {step,id}=openStageResult;
  const card=container.querySelector(`.step[data-step="${step}"]`);
  if(card&&stageResultKey(step)===id){
   card.after(stageResultPanel);
   stageResultPanel.hidden=false;
  }else{
   openStageResult=null;
   stageResultPanel.hidden=true;
  }
 }
}
document.querySelector('.project').after(document.getElementById('topic-choice-template').content.cloneNode(true));
const topicChoice=document.getElementById('topic-choice');
const topicForm=document.getElementById('topic-choice-form');
const topicCandidates=document.getElementById('topic-candidates');
const topicDurations=document.getElementById('topic-durations');
const topicSubmit=topicForm.querySelector('button[type=submit]');
const topicNext=document.getElementById('topic-next');
const topicOtherHelp=document.getElementById('topic-other-help');
const topicListStatus=document.getElementById('topic-list-status');
const topicError=document.getElementById('topic-choice-error');
const stageNotice=document.getElementById('stage-notice');
const stageResultPanel=document.getElementById('stage-result-panel');
const stageResultTitle=document.getElementById('stage-result-title');
const stageResultContent=document.getElementById('stage-result-content');
let dashboardResultSteps=[];
let topicSignature='';
let topicDurationSignature='';
let topicBatchNumber=0;
let topicBusy=false;

function topicRadio(name,value,title,details,summary){
 const label=document.createElement('label');
 const radio=document.createElement('input');
 radio.type='radio';
 radio.name=name;
 radio.value=value;
 radio.required=true;
 const text=document.createElement('span');
 const heading=document.createElement('strong');
 heading.textContent=title;
 text.append(heading);
 for(const line of [details,summary].filter(Boolean)){
  const description=document.createElement('span');
  description.textContent=line;
  text.append(description);
 }
 label.append(radio,text);
 return label;
}

function updateTopicButton(){
 topicNext.disabled=topicBusy||dashboardRunner.busy;
 topicSubmit.disabled=topicBusy||dashboardRunner.busy||
  (!topicCandidates.hidden&&!topicCandidates.querySelector('input:checked'))||
  (!topicDurations.hidden&&!topicDurations.querySelector('input:checked'));
}

function canStartDashboardStep(step,current=dashboardWork){
 if(!session||!dashboardRunner.available||dashboardRunner.busy||dashboardStartBusy||projectClosed||resetBusy||cleanupBusy||projectCloseBusy||stageCompleteBusy!==null||reviewBusy)return false;
 if(step===1)return !current.topicSelection?.candidates?.length&&(!current.topic||!current.duration);
 if(!current.topic||!current.duration)return false;
 return step===2||Boolean(current.projectPath);
}

function notifyStage(text){
 stageNotice.textContent=text;
 stageNotice.hidden=!text;
}

async function startDashboardStage(step,current=dashboardWork){
 if(!canStartDashboardStep(step,current)){
  if(!dashboardRunner.available)notifyStage('이 PC의 Codex 실행기에 연결할 수 없습니다.');
  return;
 }
 dashboardStartBusy=true;
 notifyStage('');
 try{
  const response=await fetch('/api/steps/run'+query,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({step,expectedProjectPath:current.projectPath??null,resetAt:current.resetAt??null})
  });
  const run=await response.json();
  if(!response.ok)throw Error(run.error);
  dashboardRunner={...dashboardRunner,busy:true,runs:{...dashboardRunner.runs,[step]:run}};
  if(openStageResult?.step===step){openStageResult=null;stageResultPanel.hidden=true;}
  notifyStage(`${step}단계 작업을 시작했습니다. 진행 상황은 현황표에서 확인할 수 있습니다.`);
 }catch(error){
  notifyStage(error.message||'Codex 작업을 시작하지 못했습니다.');
 }finally{
  dashboardStartBusy=false;
  signature='';
  paint();
  void refresh();
 }
}

function stageResultKey(step){
 if(step===2&&dashboardSynopsisRevision)return JSON.stringify([dashboardWork.projectPath,step,dashboardSynopsisRevision]);
 const run=dashboardRunner.runs[step];
 if(run?.resultAvailable)return run.id;
 return dashboardResultSteps.includes(step)?JSON.stringify([dashboardWork.projectPath,step]):null;
}

const resultOpenNotice=document.createElement('div');
resultOpenNotice.className='result-open-notice';
resultOpenNotice.setAttribute('role','status');
resultOpenNotice.setAttribute('aria-atomic','true');
document.body.append(resultOpenNotice);
let resultOpenNoticeTimer;

function showResultOpenNotice(message,detail,error=false){
 const title=document.createElement('strong');
 title.textContent=message;
 const description=document.createElement('span');
 description.textContent=detail;
 resultOpenNotice.classList.toggle('is-error',error);
 resultOpenNotice.replaceChildren(title,description);
 clearTimeout(resultOpenNoticeTimer);
 resultOpenNoticeTimer=setTimeout(()=>resultOpenNotice.replaceChildren(),6500);
}

function renderResultFiles(step,result,target){
 if(!result.files?.length&&!result.txt?.length)return;
 const projectPath=dashboardWork.projectPath??null;
 const resetAt=dashboardWork.resetAt??null;
 const section=document.createElement('section');
 section.className='result-files';
 const preview=document.createElement('section');
 preview.className='result-txt-preview';
 preview.hidden=true;
 const documents=new Map((result.txt??[]).map(document=>[document.id,document]));
 function txtButton(documentInfo,label){
  const button=document.createElement('button');
  button.type='button';
  button.className='quiet result-txt-button';
  button.textContent=label;
  button.setAttribute('aria-label',`${documentInfo.name} TXT 열고 이 채팅에 표시`);
  button.title='TXT 원문을 열고 이 채팅에 표시를 요청합니다';
  button.addEventListener('click',async()=>{
   button.disabled=true;
   const status=document.createElement('p');
   status.setAttribute('role','status');
   status.textContent='TXT를 열고 채팅에 표시를 요청하는 중입니다.';
   preview.replaceChildren(status);
   preview.hidden=false;
   try{
    const response=await fetch('/api/steps/result/txt'+query,{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({step,id:documentInfo.id,expectedProjectPath:projectPath,resetAt})
    });
    const documentResult=await response.json();
    if(!response.ok)throw Error(documentResult.error);
    const title=document.createElement('strong');
    title.textContent=documentInfo.name;
    const body=document.createElement('pre');
    const sceneRows=/^(\|[ \t]*I\d{2,}(?:-[A-Z])?[ \t]*\|[^\r\n]*)(\r?\n)(?=\|[ \t]*I\d{2,}(?:-[A-Z])?[ \t]*\|)/gm;
    const previewText=step===11?documentResult.text.replace(sceneRows,'$1$2$2'):documentResult.text;
    body.textContent=previewText;
    body.tabIndex=0;
    body.setAttribute('aria-label',documentInfo.name+' 원문');
    function copyButton(label,text){
     const copy=document.createElement('button');
     copy.type='button';
     copy.className='quiet';
     copy.textContent=label;
     copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(text);status.textContent=`${label} 완료. 채팅 입력창에서 Ctrl+V로 붙여 넣을 수 있습니다.`;}
      catch{status.textContent='자동 복사가 되지 않아 복사할 내용을 열었습니다.';
       const field=document.createElement('textarea');
       field.value=text;
       field.readOnly=true;
       field.setAttribute('aria-label',label);
       preview.querySelector('textarea')?.remove();
       body.before(field);
       field.select();
      }
     });
     return copy;
    }
    status.textContent=documentResult.queued
     ?documentResult.resumed?'이 채팅에 원문 표시를 요청했습니다.':'채팅에 요청을 예약했습니다. 채팅이 다시 연결되면 처리됩니다.'
     :documentResult.notice;
    const actions=document.createElement('div');
    actions.className='result-txt-actions';
    if(!documentResult.queued)actions.append(copyButton('채팅 요청 복사',documentResult.prompt));
    actions.append(copyButton('본문 복사',previewText));
    preview.replaceChildren(title,status,actions,body);
   }catch(error){status.textContent=error.message||'TXT를 열지 못했습니다.';}
   finally{button.disabled=false;}
  });
  return button;
 }
 function openButton(label,file=null){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=label;
  button.addEventListener('click',async()=>{
   button.disabled=true;
   const locationName=file?label:(result.folder==='.'?dashboardWork.topic:result.folder.split('/').at(-1));
   showResultOpenNotice('파일 탐색기를 여는 중이에요',locationName);
   try{
    const response=await fetch('/api/steps/result/open'+query,{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({step,file,expectedProjectPath:projectPath})
    });
    if(!response.ok)throw Error((await response.json()).error);
    showResultOpenNotice(file?'파일 위치를 열었어요':'저장 폴더를 열었어요',locationName);
   }catch(error){
    showResultOpenNotice('파일 탐색기를 열지 못했어요',error.message||locationName,true);
   }
   finally{button.disabled=false;}
  });
  return button;
 }
 if(result.folder){
  const folder=openButton('저장 폴더 열기');
  folder.className='quiet';
  section.append(folder);
 }
 const summary=documents.get('summary');
 if(summary)section.append(txtButton(summary,'TXT'));
 const list=document.createElement('ol');
 for(const file of result.files??[]){
  const item=document.createElement('li');
  const button=openButton(file.label,file.path);
  button.className='result-file-link';
  button.title='파일 탐색기에서 '+file.label+' 선택';
  item.append(button);
  if(file.detail)item.append(' · '+file.detail);
  const txt=documents.get(file.path);
  if(txt)item.append(txtButton(txt,'TXT'));
  list.append(item);
 }
 if(list.children.length)section.append(list);
 section.append(preview);
 target.append(section);
}

async function toggleStageResult(step,id){
 if(openStageResult?.id===id){
  openStageResult=null;
  stageResultPanel.hidden=true;
  paint();
  focusStageResultButton(step);
  return;
 }
 try{
  const revision=step===2?dashboardSynopsisRevision:null;
  const endpoint=revision?'/api/synopsis'+query:'/api/steps/result'+query+'&step='+step;
  const response=await fetch(endpoint,{cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  if(stageResultKey(step)!==id)return;
  if(revision&&result.revision!==revision)throw Error('시놉시스가 갱신됐습니다. 잠시 후 다시 열어 주세요.');
  openStageResult={step,id};
  stageResultTitle.textContent=`${step}단계 작업 결과`;
  stageResultContent.replaceChildren();
  renderResultFiles(step,result,stageResultContent);
  if(result.text)renderSynopsis(result.text.replace(/\[([^\]\r\n]+)\]\(<?[A-Za-z]:[\\/][^>\r\n)]*>?\)/g,'$1'),stageResultContent);
  paint();
  focusStageResultButton(step);
 }catch(error){notifyStage(error.message||'작업 결과를 불러오지 못했습니다.');}
}

function focusStageResultButton(step){
 container.querySelector(`.step[data-step="${step}"] .stage-result-toggle`)?.focus({preventScroll:true});
}

function synopsisLine(element,line){
 for(const [index,part] of line.split(/\*\*(.+?)\*\*/g).entries()){
  if(index%2===0)element.append(part);
  else{
   const strong=document.createElement('strong');
   strong.textContent=part;
   element.append(strong);
  }
 }
 return element;
}

function renderSynopsis(text,target){
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  const tag=heading?`h${Math.min(heading[1].length+2,6)}`:'p';
  target.append(synopsisLine(document.createElement(tag),heading?.[2]??line));
 }
}

function showTopicChoice(current){
 const selection=current.topicSelection;
 const visible=session&&current.step===1&&current.status==='awaiting_input'&&!current.projectPath&&selection&&!selection.submittedAt&&
  (!current.topic||!current.duration);
 topicChoice.hidden=!visible;
 const next=visible?JSON.stringify([current.topic,current.duration,selection]):'';
 if(next===topicSignature)return;
 topicSignature=next;
 if(!visible||selection.submittedAt)topicDurationSignature='';
 if(!visible)return;
 topicError.hidden=true;
 topicCandidates.hidden=Boolean(current.topic);
 topicDurations.hidden=Boolean(current.duration);
 topicBatchNumber=selection.batchNumber??0;
 topicNext.hidden=Boolean(current.topic)||!selection.alternativeBatches?.length;
 topicOtherHelp.hidden=Boolean(current.topic)||!topicNext.hidden;
 const candidates=topicCandidates.querySelector('.topic-options');
 candidates.replaceChildren();
 if(!current.topic){
  for(const candidate of selection.candidates??[]){
   const details=[candidate.genre?.join('·'),candidate.mood?.join('·'),candidate.origin].filter(Boolean).join(' / ');
   const option=topicRadio('candidate',candidate.number,`${candidate.number}번 · ${candidate.title}`,details,candidate.summary);
   option.querySelector('input').dataset.title=candidate.title;
   candidates.append(option);
  }
 }
 const durationSignature=JSON.stringify([current.duration,selection.durationOptions]);
 if(durationSignature!==topicDurationSignature){
  topicDurationSignature=durationSignature;
  const durations=topicDurations.querySelector('.topic-options');
  durations.replaceChildren();
  if(!current.duration){
   for(const duration of selection.durationOptions??[]){
    durations.append(topicRadio('duration',duration,duration));
   }
  }
 }
 updateTopicButton();
}

async function requestTopicChoice(route,input){
 topicBusy=true;
 updateTopicButton();
 topicError.hidden=true;
 try{
  const response=await fetch(route+query,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(input)
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  showTopicChoice(result.current);
  if(result.current.step===2){
   dashboardWork=result.current;
   statuses[1]={...statuses[1],state:'completed'};
   paint();
   const card=container.querySelector('.step[data-step="2"]');
   card?.querySelector('h2')?.focus({preventScroll:true});
   card?.scrollIntoView({block:'start'});
   if(dashboardRunner.available)void startDashboardStage(2,result.current);
  }
  return true;
 }catch(error){
  topicError.textContent=error.message||'선택을 저장하지 못했어요. 다시 시도해 주세요.';
  topicError.hidden=false;
 }finally{
  topicBusy=false;
  updateTopicButton();
  signature='';
  void refresh();
 }
 return false;
}

topicForm.addEventListener('change',updateTopicButton);
topicForm.addEventListener('submit',event=>{
 event.preventDefault();
 if(topicSubmit.disabled||topicForm.hidden)return;
 const candidate=topicCandidates.querySelector('input:checked');
 const duration=topicDurations.querySelector('input:checked')?.value;
 void requestTopicChoice('/api/topic-choice',{candidateNumber:candidate?Number(candidate.value):undefined,candidateTitle:candidate?.dataset.title,duration});
});
topicNext.addEventListener('click',async()=>{
 if(topicBusy||topicNext.hidden)return;
 if(await requestTopicChoice('/api/topic-choice/next',{batchNumber:topicBatchNumber})){
  topicListStatus.textContent=`${topicBatchNumber+1}번째 주제 후보를 불러왔습니다.`;
  topicCandidates.querySelector('input')?.focus();
 }
});

async function refresh(){if(fetching)return;fetching=true;try{const r=await fetch('/api/snapshot'+query,{cache:'no-store'});if(!r.ok)throw Error();const snapshot=await r.json();if(snapshot.session!==session||!snapshot.steps||typeof snapshot.steps!=='object')throw Error();const next=JSON.stringify(snapshot);if(next!==signature){signature=next;statuses=snapshot.steps;imageReview=snapshot.imageReview??{};const current=snapshot.current||{};projectClosed=current.projectStatus==='closed';activeProjectPath=current.projectPath;dashboardWork=current;dashboardResultSteps=snapshot.resultSteps??[];dashboardRunner=snapshot.runner??{available:false,busy:false,runs:{}};dashboardSynopsisRevision=snapshot.synopsisRevision??null;dashboardStageResetOnly=snapshot.stageResetOnly===true;showTopicChoice(current);updateTopicButton();
chatGuide.textContent=dashboardRunner.available?'현황표에서 진행할 단계의 시작 버튼을 누르세요.':current.topic?'채팅에 “다음 단계”를 입력해 이어가세요.':'채팅에 “1”을 입력하면 주제와 길이를 고를 수 있어요.';
updateCleanup(current);updateProjectClose(current);steps=expandedSteps;if(current.workflowOrderVersion!==3){const old={...statuses};if(current.workflowOrderVersion===2){statuses={...old,13:old[12]};}else{statuses={...old,10:old[12],11:old[10],13:old[11]};}delete statuses[12];}showChannelName(snapshot.channelName||'');document.querySelector('.project-info h2').textContent=current.topic||'작품 선택 전';document.querySelector('.project-info p').textContent=current.topic?[(current.duration||'길이 미정'),'고전풍 창작'].join(' · '):'현황표에서 주제와 영상 길이를 골라주세요.';paint()}resetButton.disabled=!session||resetBusy||dashboardRunner.busy;document.getElementById('connection').textContent='현황 연결됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{document.getElementById('connection').textContent='현황 연결 끊김 · 표시된 상태는 최신이 아닐 수 있습니다.'}finally{fetching=false}}
paint();setTimeout(refresh,0);setInterval(refresh,2500);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});

const channelForm=document.getElementById('channel-form');
const channelInput=document.getElementById('channel-name');
const channelStatus=document.getElementById('channel-status');
let savedChannelName='';
function showChannelName(name){
 const dirty=channelInput.value!==savedChannelName;
 savedChannelName=name;
 if(!dirty)channelInput.value=name;
}
channelForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const button=channelForm.querySelector('button');
 button.disabled=true;
 try{
  const response=await fetch('/api/channel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelName:channelInput.value})});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'채널 이름을 저장하지 못했습니다.');
  savedChannelName=result.channelName;
  channelInput.value=savedChannelName;
  channelStatus.textContent='채널 이름을 이 컴퓨터에 저장했습니다.';
 }catch(error){channelStatus.textContent=error.message;}
 finally{button.disabled=false;}
});
const cleanupOpen=document.getElementById('cleanup-open');
const cleanupDialog=document.getElementById('cleanup-dialog');
const cleanupConfirm=document.getElementById('cleanup-confirm');
let cleanupToken=null,cleanupBusy=false,cleanupController=null;
function paintCleanupLabel(completed){
 cleanupOpen.textContent=completed?'폴더정리 완료':'최종 폴더 정리·프로젝트 마무리';
}
function updateCleanup(current){
 paintCleanupLabel(Boolean(current.folderCleanup?.at));
 cleanupOpen.disabled=!session||!current.projectPath||cleanupBusy||projectCloseBusy||stageCompleteBusy!==null||dashboardRunner.busy;
}
async function cleanupRequest(action,input={},signal){
 const response=await fetch('/api/cleanup/'+action+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal});
 const result=await response.json();if(!response.ok)throw Error(result.error||'정리 요청에 실패했습니다.');return result;
}
function planSection(title,items){
 const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=title;section.append(heading);
 if(!items.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='대상 없음';section.append(empty);}
 else{const list=document.createElement('ul');for(const text of items){const li=document.createElement('li');li.textContent=text;list.append(li);}section.append(list);}
 document.getElementById('cleanup-plan').append(section);
}
cleanupOpen.addEventListener('click',async()=>{
 cleanupToken=null;cleanupConfirm.disabled=true;cleanupConfirm.textContent='정리 실행';document.getElementById('cleanup-error').textContent='';document.getElementById('cleanup-plan').replaceChildren();document.getElementById('cleanup-project').textContent='현재 작품의 파일과 참조를 확인하고 있습니다…';document.getElementById('cleanup-note').textContent='';document.getElementById('cleanup-pending').textContent='';cleanupDialog.showModal();
 cleanupController=new AbortController();
 try{
  const result=await cleanupRequest('preview',{},cleanupController.signal);if(!cleanupDialog.open)return;
  cleanupToken=result.token;document.getElementById('cleanup-project').textContent=result.projectPath;document.getElementById('cleanup-note').textContent=result.note;
  planSection(`폴더별로 이동 · ${result.moves.length}개`,result.moves.map(m=>m.from+' → '+m.to));
  planSection(`삭제 후보 · ${result.removals.length}개 (삭제하지 않음)`,result.removals.map(r=>r.path+' — '+r.reason));
  planSection(`루트에 유지 · ${result.preserved.length}개`,result.preserved.map(p=>p.path+' — '+p.reason));
  document.getElementById('cleanup-pending').textContent=`연결 경로를 갱신할 문서 ${result.referenceUpdates}개. `+(result.canFinish?'모든 단계가 완료되어 정리 후 프로젝트를 마무리합니다.':`미완료 단계 ${result.pending.join(', ')}번은 그대로 유지합니다. 지금 정리해도 나중에 다시 이어갈 수 있습니다.`);
  cleanupConfirm.textContent=result.canFinish?'정리하고 프로젝트 마무리':'정리 실행';cleanupConfirm.disabled=false;
 }catch(error){if(error.name!=='AbortError')document.getElementById('cleanup-error').textContent=error.message;}
});
function closeCleanup(){if(cleanupBusy)return;cleanupController?.abort();cleanupDialog.close();cleanupToken=null;}
for(const id of ['cleanup-close','cleanup-cancel'])document.getElementById(id).addEventListener('click',closeCleanup);
cleanupDialog.addEventListener('cancel',event=>{if(cleanupBusy)event.preventDefault();else{cleanupController?.abort();cleanupToken=null;}});
cleanupConfirm.addEventListener('click',async()=>{
 if(!cleanupToken||cleanupBusy)return;
 cleanupBusy=true;cleanupConfirm.disabled=true;cleanupOpen.disabled=true;cleanupConfirm.textContent='정리 중…';document.getElementById('cleanup-error').textContent='';
 for(const id of ['cleanup-close','cleanup-cancel'])document.getElementById(id).disabled=true;
 try{
  const result=await cleanupRequest('execute',{token:cleanupToken});cleanupToken=null;
  paintCleanupLabel(true);
  document.getElementById('cleanup-plan').replaceChildren();planSection(result.message,[`파일 이동 ${result.moved}개 · 휴지통 ${result.recycled}개 · 참조 갱신 ${result.referenceUpdates}개`,`정리 안내: ${result.reportPath}`]);
  document.getElementById('cleanup-pending').textContent=result.finished?'최종 폴더 정리가 끝났습니다.':`미완료 단계 ${result.pending.join(', ')}번은 제작 상태를 유지했습니다.`;
  cleanupConfirm.textContent='정리 완료';signature='';
 }catch(error){cleanupToken=null;document.getElementById('cleanup-error').textContent=error.message+' 창을 닫고 정리 대상을 다시 확인해 주세요.';cleanupConfirm.textContent='다시 확인 필요';}
 finally{cleanupBusy=false;for(const id of ['cleanup-close','cleanup-cancel'])document.getElementById(id).disabled=false;await refresh();}
});

const projectCloseButton=document.getElementById('project-close');
function updateProjectClose(current){
 projectCloseButton.disabled=!session||!current.projectPath||projectClosed||projectCloseBusy||cleanupBusy||dashboardRunner.busy;
 projectCloseButton.textContent=projectClosed?'프로젝트 종료 완료':projectCloseBusy?'종료 중…':'이 프로젝트 종료';
 document.getElementById('project-closed-message').hidden=!projectClosed;
 document.querySelector('.project-info .label').textContent=projectClosed?'종료된 작품':'진행 중인 작품';
}
projectCloseButton.addEventListener('click',async()=>{
 if(!activeProjectPath||projectClosed||projectCloseBusy||cleanupBusy)return;
 projectCloseBusy=true;projectCloseButton.disabled=true;cleanupOpen.disabled=true;projectCloseButton.textContent='종료 중…';document.getElementById('project-close-error').textContent='';
 try{
  const response=await fetch('/api/project/close'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedProjectPath:activeProjectPath})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'프로젝트 종료를 저장하지 못했습니다.');
  projectClosed=true;document.getElementById('project-closed-message').textContent=result.message;document.getElementById('project-closed-message').hidden=false;celebrateProjectClose();signature='';
 }catch(error){document.getElementById('project-close-error').textContent=error.message;}
 finally{projectCloseBusy=false;projectCloseButton.disabled=projectClosed;projectCloseButton.textContent=projectClosed?'프로젝트 종료 완료':'이 프로젝트 종료';await refresh();}
});

async function completeStageFromCard(step){
 if(stageCompleteBusy!==null||!activeProjectPath||cleanupBusy||projectCloseBusy)return;
 stageCompleteBusy=step;paint();document.getElementById('project-close-error').textContent='';
 try{
  const response=await fetch('/api/steps/complete'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({step,expectedProjectPath:activeProjectPath})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'완료 상태를 저장하지 못했습니다.');signature='';
 }catch(error){document.getElementById('project-close-error').textContent=error.message;}
 finally{stageCompleteBusy=null;paint();await refresh();}
}

function celebrateProjectClose(){
 document.querySelector('.project-fireworks')?.remove();
 const layer=document.createElement('div');layer.className='project-fireworks';layer.setAttribute('aria-hidden','true');
 const colors=['#ffbf35','#fa6e44','#f16fa9','#4bcd94','#6b9df5','#bc8af0'];
 for(let burst=0;burst<3;burst++){
  for(let i=0;i<36;i++){
   const spark=document.createElement('i');spark.className='firework-spark';
   const angle=Math.PI*2*i/36,reach=80+Math.random()*130;
   spark.style.setProperty('--burst-x',[24,76,50][burst]+'vw');
   spark.style.setProperty('--burst-y',[40,35,55][burst]+'vh');
   spark.style.setProperty('--spark-x',Math.cos(angle)*reach+'px');
   spark.style.setProperty('--spark-y',Math.sin(angle)*reach+'px');
   spark.style.setProperty('--delay',burst*0.65+'s');
   spark.style.setProperty('--spark-color',colors[(i+burst)%colors.length]);
   spark.style.setProperty('--spin',(Math.random()*540-270)+'deg');layer.append(spark);
  }
 }
 const badge=document.createElement('div');badge.className='firework-badge';badge.textContent='🎉';layer.append(badge);
 document.body.append(layer);
 const message=document.getElementById('project-closed-message');
 message.classList.remove('celebrating');void message.offsetWidth;message.classList.add('celebrating');
 message.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
 setTimeout(()=>{layer.remove();message.classList.remove('celebrating');},4500);
}
