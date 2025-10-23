import * as fs from "fs";
import * as path from "path";

const norm = (s:string)=>s.replace(/[^\dXx]/g,"").toUpperCase();

const isIsbn10 = (raw:string) => {
  const v = norm(raw);
  if (v.length!==10) return false;
  let sum = 0;
  for (let i=0;i<9;i++){ const d=v[i]; if(d<"0"||d>"9") return false; sum += (10-i)*Number(d); }
  const check = v[9]==="X" ? 10 : Number(v[9]);
  if (Number.isNaN(check)) return false;
  sum += check;
  return sum%11===0;
};

const isIsbn13Book = (raw:string) => {
  const v = norm(raw);
  if (v.length!==13) return false;
  if (!(v.startsWith("978")||v.startsWith("979"))) return false;
  let sum=0;
  for (let i=0;i<12;i++){ const n=Number(v[i]); if(Number.isNaN(n)) return false; sum += n*(i%2?3:1); }
  const check=(10-(sum%10))%10;
  return check===Number(v[12]);
};

const file = path.join(process.cwd(),"app","data","ranking.json");
const json = JSON.parse(fs.readFileSync(file,"utf8"));

const filtered = (json.ranking??[]).filter((b:any)=>{
  const isbn = String(b?.isbn??"");
  return isIsbn10(isbn) || isIsbn13Book(isbn);
}).sort((a:any,b:any)=> (b.totalLikes??0)-(a.totalLikes??0));

const out = { ...json, generatedAt:new Date().toISOString(), ranking: filtered };
fs.writeFileSync(file, JSON.stringify(out,null,2), "utf8");
console.log(`postfilter: in=${(json.ranking??[]).length}, out=${filtered.length}`);
