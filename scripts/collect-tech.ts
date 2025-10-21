/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Parser from "rss-parser";

type Source = { qiitaId?: string; url: string; title: string; likes: number; stocks: number };
type BookAgg = { id: string; title: string; asin?: string; mentions: number; score: number; totalLikes: number; totalStocks: number; sources: Source[] };

const md5 = (x:string)=>crypto.createHash("md5").update(x).digest("hex");

function extractBookTitle(title:string):string|null{
  const m1=title.match(/『([^』]{2,80})』/); if(m1) return m1[1].trim();
  const m2=title.match(/「([^」]{2,80})」/); if(m2) return m2[1].trim();
  const m3=title.match(/(.{2,60}?(入門|実践|大全|徹底解説|パーフェクトガイド|リファレンス|逆引き|超入門))/);
  return m3?m3[1].trim():null;
}
function tryExtractASIN(url:string){ return url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]; }
function aggKey(title:string,url?:string){ const a=url?tryExtractASIN(url):undefined; if(a) return `asin:${a}`; const t=extractBookTitle(title); return t?`title:${t}`:undefined; }

const QIITA_ENDPOINT="https://qiita.com/api/v2/items";
const QIITA_PAGES=Number(process.env.QIITA_PAGES ?? 3);
const PER_PAGE=50;
const QIITA_QUERY='title:書籍 OR title:本 OR title:入門 OR title:実践 OR title:大全 OR tag:書籍 OR tag:本 OR tag:技術書';
type QiitaItem={id:string;title:string;url:string;likes_count?:number;stocks_count?:number;tags?:{name:string}[]};

async function fetchQiitaPage(p:number,token?:string):Promise<QiitaItem[]>{
  const q=encodeURIComponent(QIITA_QUERY);
  const url=`${QIITA_ENDPOINT}?query=${q}&per_page=${PER_PAGE}&page=${p}`;
  const headers:Record<string,string>={}; if(token) headers.Authorization=`Bearer ${token}`;
  const res=await fetch(url,{headers,cache:"no-store" as any}); if(!res.ok) throw new Error(`Qiita ${res.status}`); return res.json();
}
async function collectFromQiita():Promise<Source[]>{
  const token=process.env.QIITA_TOKEN||undefined; const all:QiitaItem[]=[];
  for(let p=1;p<=QIITA_PAGES;p++){ const items=await fetchQiitaPage(p,token); if(!items?.length) break; all.push(...items); }
  const BLOCK=["絵本","児童書","保育","幼児","読み聞かせ"];
  return all.filter(it=>!BLOCK.some(w=>(it.title??"").includes(w))).map(it=>({qiitaId:it.id,url:it.url,title:it.title,likes:it.likes_count??0,stocks:it.stocks_count??0}));
}

type HatenaItem={title:string;link:string};
async function collectFromHatena(tag:string):Promise<Source[]>{
  const parser=new Parser(); const feed=await parser.parseURL(`https://b.hatena.ne.jp/entrylist?mode=rss&sort=hot&threshold=3&tag=${encodeURIComponent(tag)}`);
  const out:Source[]=[]; for(const it of (feed.items as any as HatenaItem[])){ const title=it.title??""; const url=it.link??""; if(!url) continue;
    const m=title.match(/\((\d+)\s+users?\)\s*$/i); const users=m?Number(m[1]):3; const clean=title.replace(/\(\d+\s+users?\)\s*$/i,"").trim();
    out.push({url, title: clean, likes: users, stocks: 0});
  } return out;
}

function aggregate(sources:Source[]):BookAgg[]{
  const by=new Map<string,BookAgg>();
  for(const s of sources){ const key=aggKey(s.title,s.url); if(!key) continue; const [kind,name]=key.split(":",2);
    const prev=by.get(key) ?? { id: md5(key), title: name, mentions:0, score:0, totalLikes:0, totalStocks:0, sources:[], ...(kind==="asin"?{asin:name}:{}) };
    prev.mentions+=1; prev.totalLikes+=(s.likes??0); prev.totalStocks+=(s.stocks??0); prev.sources.push(s); by.set(key,prev);
  }
  return Array.from(by.values()).map(b=>({...b,score:b.totalLikes + b.mentions*2}))
    .sort((a,b)=> (b.totalLikes-a.totalLikes) || (b.mentions-a.mentions)).slice(0,200);
}

async function main(){
  const [qiita, hTech, hProg]=await Promise.all([collectFromQiita(), collectFromHatena("技術書"), collectFromHatena("プログラミング")]);
  const ranking=aggregate([...qiita,...hTech,...hProg]);
  const outDir=path.join(process.cwd(),"app","data"); fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,"ranking.json"), JSON.stringify({generatedAt:new Date().toISOString(), source:["qiita","hatena"], ranking}, null, 2), "utf-8");
  console.log("Updated ranking.json (tech books)");
}
main().catch(e=>{console.error(e); process.exit(1);});
