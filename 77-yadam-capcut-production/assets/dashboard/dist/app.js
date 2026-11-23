const legacySteps=['주제 선택','시놉시스','대본 작성·두 번 검수','더빙용 원고 확정','스타일·캐릭터·참조 에셋','이미지프롬프트생성\n(SRT,MP3파일제공)','파일 검증·스토리 매칭','이미지 연결표','본편 렌더링·검수','인트로 제작','썸네일·업로드 준비','CapCut으로 보내기'];
const currentSteps=['주제 선택','시놉시스','대본 작성·두 번 검수','더빙용 원고 확정','스타일·캐릭터·참조 에셋','이미지프롬프트생성\n(SRT,MP3파일제공)','파일 검증·스토리 매칭','이미지 연결표','본편 렌더링·검수','CapCut으로 보내기','인트로 제작','썸네일·업로드 준비'];
const expandedSteps=[...currentSteps.slice(0,11),'고정화자 영상제작',currentSteps[11]];
let steps=expandedSteps;
let projectClosed=false,activeProjectPath=null,projectCloseBusy=false;
let stageCompleteBusy=null;
const session=new URLSearchParams(location.search).get('session');const query=session?'?session='+encodeURIComponent(session):'';const container=document.getElementById('steps');const cleanupAction=document.getElementById('cleanup-action');let statuses={};let signature='';let fetching=false;
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
 const current=steps.findIndex((_,i)=>!complete(i+1));
 const active=current>=0?statuses[current+1]?.state:null;
 document.getElementById('next').textContent=projectClosed
  ?'프로젝트 종료 · 다음 이야기는 새 채팅에서'
  :current<0?'모든 단계 완료':`${active==='running'?'현재':'다음'} · ${current+1}단계 ${steps[current]}`;
 steps.forEach((title,index)=>{
  const n=index+1;
  const entry=statuses[n]||{};
  const state=entry.state;
  const review=required.has(n);
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
  top.append(num,mark);
  const name=document.createElement('h2');
  name.textContent=title;
  name.style.whiteSpace='pre-line';
  const text=document.createElement('p');
  text.className='state';
  text.textContent=review
   ?(state==='completed'||entry.previousCompletions?.length?'이전 완료 기록 있음 · 재검수 필요':'재검수 필요')
   :complete(n)?'완료':state==='running'?'작업 중':state==='awaiting_input'?'입력 대기':state==='failed'?'확인이 필요합니다':index===current?'다음 작업':'대기';
  if(review&&imageReview.scenes?.length)text.title='새 장면 이미지: '+imageReview.scenes.join(', ');
  card.append(top,name,text);
  if(n>=10&&n<=12){
   const button=document.createElement('button');
   const blocked=review&&n===10&&(required.has(8)||required.has(9));
   button.type='button';
   button.className='stage-complete';
   button.textContent=complete(n)?'완료됨':stageCompleteBusy===n?'저장 중…':'완료';
   button.setAttribute('aria-label',`${n}단계 ${title} ${button.textContent}`);
   button.disabled=!activeProjectPath||complete(n)||blocked||stageCompleteBusy!==null||cleanupBusy||projectCloseBusy;
   if(blocked)button.title='새 이미지의 8·9단계 검수 후 CapCut 인계를 완료할 수 있어요.';
   button.addEventListener('click',()=>completeStageFromCard(n));
   card.append(button);
  }
  container.insertBefore(card,cleanupAction);
 });
}
async function refresh(){if(fetching)return;fetching=true;try{const r=await fetch('/api/snapshot'+query,{cache:'no-store'});if(!r.ok)throw Error();const snapshot=await r.json();if(snapshot.session!==session||!snapshot.steps||typeof snapshot.steps!=='object')throw Error();const next=JSON.stringify(snapshot);if(next!==signature){signature=next;statuses=snapshot.steps;imageReview=snapshot.imageReview??{};const current=snapshot.current||{};projectClosed=current.projectStatus==='closed';activeProjectPath=current.projectPath;updateCleanup(current);updateProjectClose(current);steps=expandedSteps;if(current.workflowOrderVersion!==3){const old={...statuses};if(current.workflowOrderVersion===2){statuses={...old,13:old[12]};}else{statuses={...old,10:old[12],11:old[10],13:old[11]};}delete statuses[12];}showChannelName(snapshot.channelName||'');document.querySelector('.project-info h2').textContent=current.topic||'작품 선택 전';document.querySelector('.project-info p').textContent=current.topic?[(current.duration||'길이 미정'),'고전풍 창작'].join(' · '):'주제와 길이를 채팅에서 정해주세요';paint()}document.getElementById('connection').textContent='현황 연결됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{document.getElementById('connection').textContent='현황 연결 끊김 · 표시된 상태는 최신이 아닐 수 있습니다.'}finally{fetching=false}}
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
 cleanupOpen.disabled=!session||!current.projectPath||cleanupBusy||projectCloseBusy||stageCompleteBusy!==null;
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
 projectCloseButton.disabled=!session||!current.projectPath||projectClosed||projectCloseBusy||cleanupBusy;
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
