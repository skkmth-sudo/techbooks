/* scripts/collect-tech.fixed.ts
   - Qiita API v2 からのみ取得
   - ISBN 抽出はチェックディジットで厳格化
   - likes_count 取れない記事は除外
   - MIN_LIKES / QIITA_PAGES 環境変数に対応
*/
import fs from "fs";
import path from "path";

// ---------- helpers: ISBN ----------
const normIsbn = (s: string) => s.replace(/[^\dXx]/g, "").toUpperCase();

// 近傍に「書籍らしさ」があるか（出版社/版/入門/書/本 など）
// 周辺±80文字に以下の語が1つでもあれば true
function hasBookContext(text: string, start: number, end: number): boolean {
  const ctx = text.slice(Math.max(0, start - 80), Math.min(text.length, end + 80)).toLowerCase();
  const hints = [
    "isbn", "書", "本", "入門", "大全", "実践", "第", "版", "改訂", "改訂版",
    "oreilly", "o'reilly", "オライリー",
    "技術評論社", "翔泳社", "インプレス", "マイナビ", "sbクリエイティブ", "ソフトバンククリエイティブ",
    "日経bp", "秀和システム", "朝日新聞出版", "講談社", "kindaipubl", "gijutsu hyouron"
  ];
  return hints.some(h => ctx.includes(h));
}
const isIsbn10 = (raw: string) => {
  const v = normIsbn(raw);
  if (v.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const c = v[i];
    if (c < "0" || c > "9") return false;
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

// タイトルか本文から最初の valid ISBN を抽出
const extractValidIsbn = (text: string): string | undefined => {
  if (!text) return;
  // 1) "ISBN" タグ付き候補を優先
  const reTag = /ISBN(?:-1[03])?:?\s*([0-9Xx][0-9Xx\- ]{8,16}[0-9Xx])/g;
  let m: RegExpExecArray | null;
  while ((m = reTag.exec(text)) !== null) {
    const raw = m[1];
    const cand = normIsbn(raw);
    const ok = isIsbn13(cand) || isIsbn10(cand);
    if (ok && hasBookContext(text, m.index, m.index + raw.length)) return cand;
  }
  // 2) タグなしは 978/979 始まり候補のみを審査
  const re97 = /(97[89][0-9\- ]{10,16})/g;
  while ((m = re97.exec(text)) !== null) {
    const raw = m[1];
    const cand = normIsbn(raw);
    if (isIsbn13(cand) && hasBookContext(text, m.index, m.index + raw.length)) return cand;
  }
  return;
};

// ---------- Qiita fetch ----------
type QiitaItem = {
  id: string;
  title: string;
  likes_count?: number;
  stocks_count?: number;
  url: string;
  // 下の詳細取得用
  rendered_body?: string;
};

const QIITA_TOKEN = process.env.QIITA_TOKEN;
const MIN_LIKES = Number(process.env.MIN_LIKES ?? 5);
const PAGES = Math.max(1, Math.min(10, Number(process.env.QIITA_PAGES ?? 3)));

const headers: Record<string, string> = { "User-Agent": "techbooks-collector" };
if (QIITA_TOKEN) headers["Authorization"] = `Bearer ${QIITA_TOKEN}`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

// 1) 最新記事をページング取得（likes_count/ stocks_count を持つ一覧）
async function fetchItems(): Promise<QiitaItem[]> {
  const out: QiitaItem[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const url = `https://qiita.com/api/v2/items?page=${page}&per_page=100`;
    const batch = await fetchJson<QiitaItem[]>(url);
    out.push(...batch);
  }
  return out;
}

// 2) ISBN を見つけるため、必要な記事のみ詳細取得（rendered_body）
async function hydrateBodies(items: QiitaItem[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // likes が MIN_LIKES 未満は最初から無視
  const targets = items.filter(i => (i.likes_count ?? 0) >= MIN_LIKES);
  for (const it of targets) {
    try {
      const d = await fetchJson<QiitaItem>(`https://qiita.com/api/v2/items/${it.id}`);
      map.set(it.id, d.rendered_body ?? "");
    } catch {
      map.set(it.id, "");
    }
  }
  return map;
}

// ---------- main ----------
(async () => {
  const items = await fetchItems();

  // likes カウントが取れないものは除外（RSS混在を避ける）
  const liked = items.filter(i => typeof i.likes_count === "number");

  const bodies = await hydrateBodies(liked);

  // 集計（ISBNで束ね）
  type Book = {
    isbn: string;
    title: string; // 代表タイトル（最初に見つかったもの）
    mentions: number;
    totalLikes: number;
    totalStocks: number;
    sources: Array<{ url: string; title: string; likes: number; stocks: number }>;
  };

  const byIsbn = new Map<string, Book>();

  for (const it of liked) {
    const body = bodies.get(it.id) ?? "";
    const isbn = extractValidIsbn(`${it.title}\n${body}`);
    if (!isbn) continue; // ISBNが無いなら“本ではない”として除外

    const likes = it.likes_count ?? 0;
    const stocks = it.stocks_count ?? 0;
    if (likes < MIN_LIKES) continue;

    const key = isbn;
    const b = byIsbn.get(key) ?? {
      isbn: key,
      title: it.title,
      mentions: 0,
      totalLikes: 0,
      totalStocks: 0,
      sources: [],
    };
    b.mentions += 1;
    b.totalLikes += likes;
    b.totalStocks += stocks;
    b.sources.push({ url: it.url, title: it.title, likes, stocks });
    byIsbn.set(key, b);
  }

  // ランキング配列へ
  const ranking = Array.from(byIsbn.values())
    .sort((a, b) => b.totalLikes - a.totalLikes);

  if (ranking.length === 0) {
    console.error("No valid books found after strict filtering. Try lowering MIN_LIKES or increasing QIITA_PAGES.");
    process.exit(2);
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
})().catch(e => {
  console.error(e);
  process.exit(1);
});


