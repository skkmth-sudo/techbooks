/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Node20+ は fetch が同梱
type QiitaItem = {
  id: string;
  title: string;
  url: string;
  likes_count: number;
  stocks_count: number;
  created_at?: string;
};

type Source = { qiitaId?: string; url: string; title: string; likes: number; stocks: number };
type BookAgg = {
  id: string; title: string; asin?: string; isbn?: string;
  mentions: number; score: number; totalLikes: number; totalStocks: number;
  sources: Source[];
};

const OUT = path.join("app","data","ranking.json");

// ---- 設定 ----
const PAGES = Number(process.env.QIITA_PAGES ?? 3);           // 何ページ取るか
const MIN_LIKES = Number(process.env.MIN_LIKES ?? 5);          // いいね最低ライン
const STRICT = true;                                           // 常に「本の証拠」必須
const QIITA_TOKEN = process.env.QIITA_TOKEN || "";

// 書籍判定
const reISBN13 = /\b(?:ISBN[- ]?(?:13)?:?\s*)?(97[89])[-\s]?\d{1,5}[-\s]?\d+[-\s]?\d+[-\s]?(\d)\b/i;
const reISBN10 = /\b(?:ISBN[- ]?(?:10)?:?\s*)?(\d{1,5}[-\s]?\d+[-\s]?\d+[-\s]?[\dXx])\b/;
const reAmazonASIN = /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:.*?\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const reQuoted = /[『「](.{2,120}?)[」』]/;

const BOOKY_KEYWORDS = /(技術書|書評|レビュー|読んだ|入門|実践|独習|詳解|教科書|徹底解説|図解|逆引き|第\s*\d+\s*版|改訂|新版|新訂)/;

// 検索クエリ（Qiita）
const SEARCH_QUERY =
  [
    'title:技術書 OR title:書評 OR title:レビュー',
    'body:技術書 OR body:書評 OR body:レビュー OR body:ISBN OR body:Amazon',
  ].join(" ");

const md5 = (x:string)=>crypto.createHash("md5").update(x).digest("hex");

async function fetchQiitaPage(page:number): Promise<QiitaItem[]> {
  const url = new URL("https://qiita.com/api/v2/items");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "100");
  url.searchParams.set("query", SEARCH_QUERY);

  const headers: Record<string,string> = {};
  if (QIITA_TOKEN) headers["Authorization"] = `Bearer ${QIITA_TOKEN}`;

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Qiita HTTP ${r.status}`);
  const arr = await r.json() as any[];
  return arr.map(x => ({
    id: x.id,
    title: x.title,
    url:  x.url,
    likes_count: Number(x.likes_count ?? 0),
    stocks_count: Number(x.stocks_count ?? 0),
    created_at: x.created_at,
  }));
}

async function fetchHtml(url:string): Promise<string> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) return "";
  return await r.text();
}

function detectFromText(txt:string) {
  const mAsin = txt.match(reAmazonASIN);
  const m13 = txt.match(reISBN13);
  const m10 = txt.match(reISBN10);
  const mQuoted = txt.match(reQuoted);
  const asin = mAsin ? mAsin[1] : undefined;
  const isbn = m13 ? m13[0].replace(/[^0-9Xx]/g,"") :
              m10 ? m10[1].replace(/[^0-9Xx]/g,"") : undefined;
  const qTitle = mQuoted ? mQuoted[1] : undefined;
  return { asin, isbn, qTitle };
}

function keyOf(b:{asin?:string;isbn?:string;title?:string}) {
  if (b.isbn) return `isbn:${b.isbn}`;
  if (b.asin) return `asin:${b.asin}`;
  return `title:${(b.title ?? "").replace(/\s+/g," ").toLowerCase()}`;
}

async function main() {
  const all: QiitaItem[] = [];
  for (let p=1; p<=PAGES; p++) {
    try {
      const page = await fetchQiitaPage(p);
      all.push(...page);
    } catch (e:any) {
      console.warn("Qiita page error", p, e?.message);
    }
  }

  // いいねで足切り
  const filtered = all.filter(x => x.likes_count >= MIN_LIKES);

  // 本の証拠チェック（Amazon/ISBN）: HTMLを軽く取得して判定
  const map = new Map<string, BookAgg>();

  for (const it of filtered) {
    let evidence = detectFromText(it.title);
    if (!evidence.asin && !evidence.isbn) {
      try {
        const html = await fetchHtml(it.url);
        const ev2 = detectFromText(html);
        if (ev2.asin || ev2.isbn) evidence = ev2;
      } catch {}
    }
    // さらに書籍語が本文/タイトルにいるかのヒント
    const looksBook = BOOKY_KEYWORDS.test(it.title);

    if (STRICT) {
      if (!evidence.asin && !evidence.isbn) continue; // 本の証拠が無ければ弾く
    } else {
      if (!evidence.asin && !evidence.isbn && !looksBook) continue;
    }

    const title =
      evidence.qTitle && evidence.qTitle.length >= 2 ? evidence.qTitle :
      it.title;

    const key = keyOf({ asin: evidence.asin, isbn: evidence.isbn, title });
    const id = md5(key);
    const likes = it.likes_count;
    const stocks = it.stocks_count;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        id,
        title,
        asin: evidence.asin,
        isbn: evidence.isbn,
        mentions: 1,
        totalLikes: likes,
        totalStocks: stocks,
        score: likes + stocks*0.7 + 3,
        sources: [{ qiitaId: it.id, url: it.url, title: it.title, likes, stocks }],
      });
    } else {
      existing.mentions += 1;
      existing.totalLikes += likes;
      existing.totalStocks += stocks;
      existing.score = existing.totalLikes + existing.totalStocks*0.7 + existing.mentions*3;
      existing.sources.push({ qiitaId: it.id, url: it.url, title: it.title, likes, stocks });
    }
  }

  const ranking = Array.from(map.values())
    .sort((a,b)=> (b.totalLikes - a.totalLikes) || (b.score - a.score));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: ["qiita"],
    strict: STRICT,
    minLikes: MIN_LIKES,
    pages: PAGES,
    ranking,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Updated ranking.json: books=${ranking.length}, from qiita items=${all.length}, after likes>=${MIN_LIKES}: ${filtered.length}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
