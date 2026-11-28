import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

function inside(directory,target){
 const relative=path.relative(directory,target);
 return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}

const workerScript=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$encoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=$encoding
[Console]::OutputEncoding=$encoding
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class YadamExplorerWindow {
 [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
 [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
 [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint caller, uint other, bool attach);
 [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

 [DllImport("user32.dll")] private static extern IntPtr GetTopWindow(IntPtr window);
 [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relationship);
 [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);

 public static long FrontExplorerWindow(long[] explorerHandles) {
  for (IntPtr window = GetTopWindow(IntPtr.Zero); window != IntPtr.Zero; window = GetWindow(window, 2)) {
   long handle = window.ToInt64();
   if (Array.IndexOf(explorerHandles, handle) >= 0 && IsWindowVisible(window) && !IsIconic(window)) return handle;
  }
  return 0;
 }

 public static bool ShowInFront(IntPtr window) {
  if (window == IntPtr.Zero) return false;
  if (IsIconic(window)) ShowWindow(window, 9);
  SetForegroundWindow(window);
  if (GetForegroundWindow() == window) return true;

  uint caller = GetCurrentThreadId();
  uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
  bool attached = foreground != 0 && caller != foreground && AttachThreadInput(caller, foreground, true);
  try {
   BringWindowToTop(window);
   SetForegroundWindow(window);
   return GetForegroundWindow() == window;
  } finally {
   if (attached) AttachThreadInput(caller, foreground, false);
  }
 }
}
"@
$explorer=New-Object -ComObject Shell.Application

function Confirm-ExplorerSelection($window,$folder,$file) {
 $view=$window.Document
 if([string]$view.Folder.Self.Path -ine $folder){return $false}
 if($file){
  $item=$view.Folder.ParseName($file)
  if(!$item){return $false}
  $view.SelectItem($item,29)
  $selected=@($view.SelectedItems() | ForEach-Object { [string]$_.Path })
  if($selected -inotcontains (Join-Path $folder $file)){return $false}
 }
 return [YadamExplorerWindow]::ShowInFront([IntPtr]$window.HWND)
}

function Select-ExplorerResult($folder,$file) {
 $windows=@($explorer.Windows())
 $existingHandles=[long[]]@($windows | ForEach-Object { try { [long]$_.HWND } catch {} })
 $front=[YadamExplorerWindow]::FrontExplorerWindow($existingHandles)
 if($front){
  $frontWindows=@($windows | Where-Object { try { [long]$_.HWND -eq $front } catch { $false } })
  if($frontWindows.Count -eq 1){
   try{
    if(Confirm-ExplorerSelection $frontWindows[0] $folder $file){return $true}
   }catch{}
  }
 }

 $explorer.ShellExecute($folder,'','','opennewwindow',1)
 $opened=[Diagnostics.Stopwatch]::StartNew()
 while($opened.ElapsedMilliseconds -lt 5500){
  foreach($window in $explorer.Windows()){
   try{
    if($existingHandles -contains [long]$window.HWND){continue}
    if(Confirm-ExplorerSelection $window $folder $file){return $true}
   }catch{}
  }
  Start-Sleep -Milliseconds 90
 }
 return $false
}

while($null -ne ($line=[Console]::ReadLine())){
 $request=$null
 $verified=$false
 try{
  $request=ConvertFrom-Json -InputObject $line
  $verified=Select-ExplorerResult $request.folder $request.file
 }catch{}
 $response=@{id=$request.id;verified=$verified} | ConvertTo-Json -Compress
 [Console]::WriteLine($response)
}
`;

let worker;
let requestId=0;
const openFailure=()=>Error('Windows에서 파일 탐색기 창을 열지 못했습니다.');

function getWorker(){
 if(worker)return worker;
 const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const processOptions={windowsHide:true,stdio:['pipe','pipe','ignore']};
 const child=spawn(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(workerScript,'utf16le').toString('base64')],processOptions);
 const pending=new Map();
 const active={child,pending};
 worker=active;
 function fail(){
  if(worker===active)worker=undefined;
  for(const finish of pending.values())finish(false);
 }
 child.on('error',fail);
 child.once('close',fail);
 child.stdin.on('error',()=>{fail();child.kill();});
 const output=createInterface({input:child.stdout,crlfDelay:Infinity});
 output.on('line',line=>{
  try{
   const {id,verified}=JSON.parse(line);
   pending.get(id)?.(verified===true);
  }catch{}
 });
 return active;
}

function selectInExplorer(folder,file){
 const {child,pending}=getWorker();
 const id=++requestId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(false),8000);
  function finish(verified){
   clearTimeout(timer);
   pending.delete(id);
   if(verified)resolve();
   else reject(openFailure());
  }
  pending.set(id,finish);
  child.stdin.write(JSON.stringify({id,folder,file})+'\n',error=>{if(error)finish(false);});
 });
}


export function openResultInExplorer(current,result,selection){
 const selected=selection==null?result.folder:result.files.find(file=>file.path===selection)?.path;
 if(!selected)throw Error('현재 결과에서 열 수 있는 파일이나 폴더를 선택해 주세요.');
 if(process.platform!=='win32')throw Error('저장 위치 열기는 Windows에서 사용할 수 있습니다.');
 const root=fs.realpathSync.native(current.projectPath);
 const target=fs.realpathSync.native(path.resolve(root,selected));
 if((target!==root&&!inside(root,target))||(selection==null?!fs.statSync(target).isDirectory():!fs.statSync(target).isFile())){
  throw Error('작품 폴더에서 결과의 위치를 확인해 주세요.');
 }
 return selectInExplorer(selection==null?target:path.dirname(target),selection==null?null:path.basename(target));
}

function startExplorerBridge(){
 const port=8792;
 const dashboard='http://127.0.0.1:8790';
 const workspace=fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
 const allowedRoots=['야담작업','❤️야담작업'].map(name=>path.join(workspace,name));
 const origins=new Set([dashboard,'http://localhost:8790']);
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.headers.host!=='127.0.0.1:'+port)return json(403,{error:'로컬 현황표에서 열어 주세요.'});
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(req.method==='GET'&&url.pathname==='/health')return json(200,{service:'yadam-result-explorer',pid:process.pid});
  if(!origins.has(origin))return json(403,{error:'현황표에서 직접 열어 주세요.'});
  if(url.pathname!=='/api/steps/result/open')return json(404,{error:'파일 열기 주소를 확인해 주세요.'});
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   return res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'}).end();
  }
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return json(405,{error:'현황표에서 직접 열어 주세요.'});
  try{
   const session=url.searchParams.get('session');
   if(!/^[a-zA-Z0-9_-]{1,96}$/.test(session??''))throw Error('현재 채팅의 현황표를 열어 주세요.');
   let body='';
   for await(const chunk of req){
    body+=chunk;
    if(Buffer.byteLength(body)>4096)throw Error('요청이 너무 큽니다.');
   }
   const {step,file,expectedProjectPath,resetAt}=JSON.parse(body);
   if(!Number.isInteger(step)||step<1||step>13||(file!==null&&typeof file!=='string'))throw Error('결과 파일을 선택해 주세요.');
   const query='?session='+encodeURIComponent(session);
   async function readDashboard(route){
    const response=await fetch(dashboard+route,{signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw Error('현황표의 결과 보기를 다시 열어 주세요.');
    return response.json();
   }
   const current=await readDashboard('/api/current'+query);
   if(!current.projectPath||current.dashboardSession!==session||current.projectPath!==expectedProjectPath||
    (current.resetAt??null)!==(resetAt??null))throw Error('현재 작품의 결과 보기를 다시 열어 주세요.');
   const project=fs.realpathSync.native(current.projectPath);
   if(!allowedRoots.some(root=>inside(root,project)))throw Error('현재 작품 폴더를 확인해 주세요.');
   const result=await readDashboard('/api/steps/result'+query+'&step='+step);
   await openResultInExplorer(current,result,file);
   return json(200,{opened:true,verified:true});
  }catch(error){return json(409,{error:error.message});}
 });
 server.listen(port,'127.0.0.1',()=>getWorker());
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startExplorerBridge();
