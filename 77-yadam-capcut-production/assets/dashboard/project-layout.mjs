// User-defined permanent layout. Preserve every file; deletion is review-only.
export const requiredFolders=[
 '더빙원고/본문종합','더빙원고/분할더빙원고',
 '이미지폴더/캐릭터','이미지폴더/에셋','이미지폴더/장면',
 '인트로영상/인트로이미지','인트로영상/인트로영상',
 '오디오자막소스/SRT','오디오자막소스/MP3','본편최종결과','유튜브업로드','제작관리'
];
export const directoryMoves=[
 ['캐릭터시트','이미지폴더/캐릭터'],['참조에셋','이미지폴더/에셋'],
 ['캐릭터','이미지폴더/캐릭터'],['본편장면이미지','이미지폴더/장면'],
 ['스타일예시','이미지폴더/스타일참조'],
 ['장면이미지','이미지폴더/장면'],['스타일참조','이미지폴더/스타일참조'],
 ['장면제작','이미지폴더/장면/제작자료'],['인트로제작','인트로영상/제작자료'],
 ['제공원본','이미지폴더/제공원본'],['최종결과','본편최종결과'],
 ['CapCut인계','본편최종결과/CapCut인계'],['제작문서','제작관리']
].map(([from,to])=>({from,to,directory:true}));
export function destination(relative){
 const p=relative.replaceAll('\\','/'),name=p.split('/').at(-1),ext=name.split('.').at(-1).toLowerCase();
 if(['00_제작진행.md','프로젝트안내.md','현황표상태.json','AGENTS.md'].includes(p))return p;
 // Final canonical folders are stable across repeat runs.
 if(/^(이미지폴더|오디오자막소스|본편최종결과|유튜브업로드|제작관리)\//.test(p)||/^더빙원고\/(본문종합|분할더빙원고)\//.test(p)||/^인트로영상\/(인트로이미지|인트로영상|제작자료)\//.test(p))return p;
 if(ext==='mp3')return '오디오자막소스/MP3/'+name;
 if(ext==='srt')return '오디오자막소스/SRT/'+name;
 if(p.startsWith('더빙원고/'))return '더빙원고/'+(name==='00_발화기준원문.txt'?'본문종합/':'분할더빙원고/')+name;
 if(p.startsWith('인트로영상/'))return '인트로영상/'+(/^(png|jpg|jpeg|webp)$/.test(ext)?'인트로이미지/':/^(mp4|mov|webm)$/.test(ext)?'인트로영상/':'제작자료/')+name;
 if(/^본편영상_검수\.(md|json)$/.test(name))return '본편최종결과/검수/'+name;
 if(/^(02_최종대본|03_더빙원고_복사용)\.md$/.test(name))return '더빙원고/본문종합/'+name;
 if(name==='04_캐릭터설정_프롬프트.md')return '이미지폴더/캐릭터/'+name;
 if(name==='06_참조에셋_프롬프트_검수.md'||name==='에셋목록.json')return '이미지폴더/에셋/'+name;
 if(name==='07_이미지스타일.md')return '이미지폴더/스타일참조/'+name;
 if(name.endsWith('_이미지연결표.json'))return '이미지폴더/장면/제작자료/'+name;
 for(const rule of directoryMoves)if(p.startsWith(rule.from+'/'))return rule.to+p.slice(rule.from.length);
 if(ext==='zip')return '이미지폴더/제공원본/'+name;
 if(/_본편\.mp4$/i.test(name))return '본편최종결과/'+name;
 if(['md','json','txt','csv'].includes(ext))return '제작관리/'+p;
 return p;
}
