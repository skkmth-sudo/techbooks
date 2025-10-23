/* scripts/collect-tech.fixed.ts (strict)
   - Qiita API v2 だけを使用
   - ISBN は: (a) "ISBN"タグ付き か (b) 978/979始まり かつ 近傍に出版社語彙
   - ASIN は一旦不採用（誤検出防止）
   - likes>=MIN_LIKES の記事のみ採用
*/
import fs from "fs";
import path from "path";

const normIsbn = (s: string) => s.replace(/[^\dXx]/g, "").toUpperCase();

const isIsbn10 = (raw: string) => {
  const v = normIsbn(raw);
  if (v.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const c = v[i]; if (c < "0" || c > "9") return false;
    sum += (10 - i) * Number(c);
  }
  const check = v[9] === "X" ? 10 : Number(v[9]);
  if (Number.isNaN(check)) return false;
  sum += check;
  return sum % 11 === 0;
};

const isIsbn13 = (raw: string) => {
  const v = normIsbn(raw);
  if (v.length !== 13) return false;
  if (!(v.startsWith("978") || v.startsWith("979"))) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(v[i]); if (Number.isNaN(n)) return false;
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(v[12]);
};

function hasPublisherContext(text: string, start: number, end: number): boolean {
  const ctx = text.slice(Math.max(0, start - 100), Math.min(text.length, end + 100)).toLowerCase();
  const pubs = [
    "oreilly","o'reilly","オライリー","技術評論社","翔泳社","インプレス","マイナビ",
    "sbクリエイティブ","日経bp","秀和システム","講談社","達人出版","ソシム","kindaipubl"
  ];
  return pubs.some(p => ctx.includes(p));
}

// 1) ISBNタグ付き最優先 → 2) 978/979で近傍に出版社語彙
function extractValidIsbn(text: string): string | undefined {
  if (!text) return;
  const reTag = /ISBN(?:-1[03])?:?\s*([0-9Xx][0-9Xx\- ]{8,16}[0-9Xx])/gi;
  let m: RegExpExecArray | null;
  while ((m = reTag.exec(text)) !== null) {
    const raw = m[1];
    const cand = normIsbn(raw);
    const ok = (isIsbn13(cand) || isIsbn10(cand)) && hasPublisherContext(text, m.index, m.index + raw.length);
    if (ok) return cand;
  }
  const re978 = /(97[89][0-9\- ]{10,16})/gi;
  while ((m = re978.exec(text)) !== null) {
    const raw = m[1];
    const cand = normIsbn(raw);
    if (isIsbn13(cand) && hasPublisherContext(text, m.index, m.index + raw.length)) return cand;
  }
  return;
}

type QiitaItem = {
  id: string; title: string; url: string;
  likes_count?: number; stocks_count?: number;
  rendered_body?: string; body?: string;
};

const QIITA_TOKEN = process.env.QIITA_TOKEN;
const MIN_LIKES = Number(process.env.MIN_LIKES ?? 3);
const PAGES = Math.max(1, Math.min(10, Number(process.env.QIITA_PAGES ?? 10)));

const headers: Record<string, string> = { "User-Agent": "techbooks-collector" };
if (QIITA_TOKEN) headers["Authorization"] = `Bearer ${QIITA_TOKEN}`;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

async function fetchItems(): Promise<QiitaItem[]> {
  const out: QiitaItem[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const url = `https://qiita.com/api/v2/items?page=${page}&per_page=100`;
    const batch = await fetchJson<QiitaItem[]>(url);
    out.push(...batch);
  }
  return out;
}

async function fetchDetail(id: string): Promise<QiitaItem> {
  return fetchJson<QiitaItem>(`https://qiita.com/api/v2/items/${id}`);
}

(async () => {
  const items = await fetchItems();
  const liked = items.filter(i => typeof i.likes_count === "number" && (i.likes_count ?? 0) >= MIN_LIKES);

  const byIsbn = new Map<string, {
    isbn: string; title: string; mentions: number;
    totalLikes: number; totalStocks: number;
    sources: Array<{url:string; title:string; likes:number; stocks:number}>;
  }>();

  for (const it of liked) {
    let body = "";
    try { const d = await fetchDetail(it.id); body = d.rendered_body || d.body || ""; } catch {}
    const text = `${it.title}\n${body}`;
    const isbn = extractValidIsbn(text);
    if (!isbn) continue; // ← ここで厳格に弾く（ASINは使わない）

    const likes = it.likes_count ?? 0;
    const stocks = it.stocks_count ?? 0;

    const b = byIsbn.get(isbn) ?? {
      isbn, title: it.title, mentions: 0, totalLikes: 0, totalStocks: 0, sources: [],
    };
    b.mentions += 1;
    b.totalLikes += likes;
    b.totalStocks += stocks;
    b.sources.push({ url: it.url, title: it.title, likes, stocks });
    byIsbn.set(isbn, b);
  }

  const ranking = Array.from(byIsbn.values()).sort((a,b)=>b.totalLikes-a.totalLikes);
  if (ranking.length === 0) {
    console.error("No valid books found. (Try lowering MIN_LIKES or check ISBN context rules)");
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: ["qiita"],
    strict: true,
    minLikes: MIN_LIKES,
    pages: PAGES,
    ranking,
  };
  const file = path.join(process.cwd(), "app", "data", "ranking.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { encoding: "utf8" });
  console.log(`Updated ranking.json: books=${ranking.length}, from qiita items=${items.length}, after likes>=${MIN_LIKES}: ${ranking.reduce((n,b)=>n+b.mentions,0)}`);
})().catch(e => { console.error(e); process.exit(1); });
