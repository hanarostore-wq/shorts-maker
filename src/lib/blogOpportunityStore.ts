import { getSharedRedis } from "@/lib/store";

export interface BlogOpportunity {
  keyword: string;
  trendScore: number;
  trendGrowth: number;
  blogSupply: number;
  recentSupply: number;
  opportunityScore: number;
  reason: string;
  collectedAt: string;
}
const KEY="moneyos:blog:naver:opportunities";
let memory:BlogOpportunity[]=[];
export async function listBlogOpportunities(){
 const r=getSharedRedis(); if(!r) return memory; return (await r.get<BlogOpportunity[]>(KEY))||[];
}
export async function saveBlogOpportunities(items:BlogOpportunity[]){
 const r=getSharedRedis(); if(!r){memory=items;return;} await r.set(KEY,items);
}
