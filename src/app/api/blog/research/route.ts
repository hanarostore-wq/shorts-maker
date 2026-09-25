import { NextResponse } from "next/server";
import { listBlogOpportunities, saveBlogOpportunities } from "@/lib/blogOpportunityStore";

const trendUrl="https://openapi.naver.com/v1/datalab/search";
const searchUrl="https://openapi.naver.com/v1/search/blog.json";

function credentials(){
 const id=process.env.NAVER_DATALAB_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
 const secret=process.env.NAVER_DATALAB_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;
 if(!id||!secret) throw new Error("NAVER_DATALAB_CLIENT_ID/SECRET 환경변수가 필요합니다.");
 return {id,secret};
}
function headers(){const c=credentials();return {"X-Naver-Client-Id":c.id,"X-Naver-Client-Secret":c.secret,"Content-Type":"application/json"};}
const ymd=(d:Date)=>d.toISOString().slice(0,10);
async function trend(keyword:string){
 const end=new Date(); const start=new Date(end.getTime()-90*86400000);
 const r=await fetch(trendUrl,{method:"POST",headers:headers(),body:JSON.stringify({startDate:ymd(start),endDate:ymd(end),timeUnit:"week",keywordGroups:[{groupName:keyword,keywords:[keyword]}]})});
 if(!r.ok) throw new Error(`DataLab ${r.status}`);
 const j=await r.json(); const data=j.results?.[0]?.data||[]; const vals=data.map((x:{ratio:number})=>Number(x.ratio)||0);
 const latest=vals.at(-1)||0, prior=vals.length>2?vals.slice(-4,-1).reduce((a:number,b:number)=>a+b,0)/Math.min(3,vals.length-1):latest;
 return {score:latest,growth:prior?((latest-prior)/prior)*100:0};
}
async function supply(keyword:string){
 const r=await fetch(`${searchUrl}?query=${encodeURIComponent(keyword)}&display=10&sort=date`,{headers:headers(),cache:"no-store"});
 if(!r.ok) throw new Error(`Blog Search ${r.status}`);
 const j=await r.json(); const now=Date.now();
 const recent=(j.items||[]).filter((x:{postdate:string})=>{const s=x.postdate||"";if(s.length!==8)return false;const t=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00+09:00`).getTime();return now-t<=30*86400000}).length;
 return {total:Number(j.total)||0,recent};
}
export async function GET(){return NextResponse.json({items:await listBlogOpportunities(),configured:Boolean((process.env.NAVER_DATALAB_CLIENT_ID||process.env.NAVER_SEARCH_CLIENT_ID)&&(process.env.NAVER_DATALAB_CLIENT_SECRET||process.env.NAVER_SEARCH_CLIENT_SECRET))});}
export async function POST(req:Request){
 try{
  const b=await req.json(); const keywords=[...new Set((Array.isArray(b?.keywords)?b.keywords:[]).map((x:unknown)=>String(x).trim()).filter(Boolean))].slice(0,20);
  if(!keywords.length) return NextResponse.json({error:"조사할 키워드를 입력하세요."},{status:400});
  const out=[];
  for(const k of keywords){const [t,s]=await Promise.all([trend(k),supply(k)]);
   const demand=Math.min(100,Math.max(0,t.score)); const scarcity=Math.max(0,100-Math.min(100,Math.log10(s.total+1)*20)); const freshness=Math.max(0,100-Math.min(100,s.recent*10)); const growth=Math.max(0,Math.min(100,50+t.growth));
   const score=Math.round(demand*.35+growth*.2+scarcity*.3+freshness*.15);
   out.push({keyword:k,trendScore:+t.score.toFixed(2),trendGrowth:+t.growth.toFixed(1),blogSupply:s.total,recentSupply:s.recent,opportunityScore:score,reason:`수요 ${t.score.toFixed(1)} · 증감 ${t.growth.toFixed(1)}% · 블로그 ${s.total.toLocaleString()}건 · 최근30일 표본 ${s.recent}/10`,collectedAt:new Date().toISOString()});
  }
  out.sort((a,b)=>b.opportunityScore-a.opportunityScore); await saveBlogOpportunities(out); return NextResponse.json({ok:true,items:out});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:500});}
}
