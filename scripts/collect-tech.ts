/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Parser from "rss-parser";

type Source = { qiitaId?: string; url: string; title: string; likes: number; stocks: number };
type BookAgg = {
  id: string; title: string; asin?: string; isbn?: string;
  mentions: number; score: number; totalLikes: number; totalStocks: number;
  sources: Source[];
};
type FeedItem = {
  link: string; title: string; contentSnippet?: string; isoDate?: string;
};

// ===== 設定 =====
const OUT = path.join("app", "data", "ranking.json");
const STRICT_BOOK_ONLY = process.env.STRICT_BOOK_ONLY !== "0"; // 1(既定)=ISBN/ASIN/出版社リンク必須
const MIN_LIKES = Number(process.env.MIN_LIKES ?? 0);         // 例: 5 にすると5未満は除外

// RSS（必要に応じて増やせます）
const FEEDS = [
  "https://qiita.com/popular-items/feed",
  "https://b.hatena.ne.jp/hotentry/it.rss",
];

// 書籍判定用：正規表現
const reISBN13 = /\b(?:ISBN[- ]?(?:13)?:?\s*)?(97[89])[-\s]?\d{1,5}[-\s]?\d+[-\s]?\d+[-\s]?(\d)\b/i;
const reISBN10 = /\b(?:ISBN[- ]?(?:10)?:?\s*)?(\d{1,5}[-\s]?\d+[-\s]?\d+[-\s]?[\dXx])\b/;
const reAmazonASIN = /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:.*?\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

// よく見る出版社/書籍系ドメイン
const PUBLISHER_HOSTS = [
  "gihyo.jp","gihyo.co.jp","oreilly.co.jp","www.oreilly.co.jp",
  "www.seshop.com","shoeisha.co.jp","book.impress.co.jp","impress.co.jp",
  "books.mdn.co.jp","gakken.co.jp","sbcr.jp","book.mynavi.jp","ascii.jp",
  "ohmsha.co.jp","techbookfest.org","booth.pm"
];

// 書籍っぽい語
const BOOKY_KEYWORDS = /(入門|実践|独習|詳解|基礎|教科書|逆引き|徹底解説|完全|図解|やさしい|最短|速習|超入門|第\s*\d+\s*版|改訂|増補|新版|新訂)/;

// 書名の括弧
const reQuoteTitle = /[『「](.{2,80}?)[」』]/;

// ===== ユーティリティ =====
const md5 = (x: string) => crypto.createHash("md5").update(x).digest("hex");
const toText = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();

// RSS パース
async function fetchFeeds(): Promise<FeedItem[]> {
  const parser = new Parser();
  const out: FeedItem[] = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items) {
        out.push({
          link: it.link || "",
          title: it.title || "",
          contentSnippet: (it as any).contentSnippet || (it as any).content || "",
          isoDate: it.isoDate,
        });
      }
    } catch (e) {
      console.warn("feed error:", url, (e as Error).message);
    }
  }
  return out;
}

// 書籍情報検出
function detectBook(item: FeedItem): { asin?: string; isbn?: string; title?: string } | null {
  const text = [item.title, item.contentSnippet].map(toText).join("  ");

  // 1) ISBN
  const m13 = text.match(reISBN13);
  const m10 = text.match(reISBN10);
  const isbn = m13 ? m13[0].replace(/[^0-9Xx]/g, "") :
               m10 ? m10[1].replace(/[^0-9Xx]/g, "") : undefined;

  // 2) Amazon ASIN
  const mAsin = text.match(reAmazonASIN);
  const asin = mAsin ? mAsin[1] : undefined;

  // 3) 出版社系リンク
  const hasPublisherLink = PUBLISHER_HOSTS.some((h) => text.includes(h));

  // 4) 引用書名 + 書籍語（緩めたい場合のみ使用）
  let quotedTitle: string | undefined;
  const mQuote = text.match(reQuoteTitle);
  if (mQuote && BOOKY_KEYWORDS.test(text)) {
    quotedTitle = mQuote[1];
  }

  if (STRICT_BOOK_ONLY) {
    // ISBN/ASIN/出版社リンクのいずれか必須
    if (!isbn && !asin && !hasPublisherLink) return null;
    const title = quotedTitle ?? (item.title || undefined);
    return { asin, isbn, title };
  } else {
    if (isbn || asin || hasPublisherLink || quotedTitle) {
      const title = quotedTitle ?? (item.title || undefined);
      return { asin, isbn, title };
    }
    return null;
  }
}

// 集計キー（ISBN>ASIN>タイトル正規化）
function keyOf(b: { isbn?: string; asin?: string; title?: string }) {
  if (b.isbn) return `isbn:${b.isbn}`;
  if (b.asin) return `asin:${b.asin}`;
  const t = toText(b.title).replace(/第\s*\d+\s*版|改訂|新版|新訂/g, "").toLowerCase();
  return `title:${t}`;
}

// likes/stocks は RSS では取得不可：必要なら Qiita API で補完（今は0で集計）
function estimateLikesStocks(_item: FeedItem): { likes: number; stocks: number } {
  return { likes: 0, stocks: 0 };
}

// ===== メイン =====
async function main() {
  const feedItems = await fetchFeeds();

  // 候補抽出（書籍判定）
  const candidates: Array<{ item: FeedItem; book: { asin?: string; isbn?: string; title?: string } }> = [];
  for (const it of feedItems) {
    const book = detectBook(it);
    if (book) candidates.push({ item: it, book });
  }

  // 集計
  const map = new Map<string, BookAgg>();
  for (const { item, book } of candidates) {
    const { likes, stocks } = estimateLikesStocks(item);
    if (MIN_LIKES > 0 && likes < MIN_LIKES) continue;

    const k = keyOf(book);
    const id = md5(k);
    const exists = map.get(k);
    if (!exists) {
      map.set(k, {
        id,
        title: book.title ?? "(書名不明)",
        asin: book.asin,
        isbn: book.isbn,
        mentions: 1,
        score: likes + stocks * 0.7 + 3,
        totalLikes: likes,
        totalStocks: stocks,
        sources: [{ url: item.link, title: item.title, likes, stocks }],
      });
    } else {
      exists.mentions += 1;
      exists.totalLikes += likes;
      exists.totalStocks += stocks;
      exists.score = exists.totalLikes + exists.totalStocks * 0.7 + exists.mentions * 3;
      exists.sources.push({ url: item.link, title: item.title, likes, stocks });
    }
  }

  const ranking = Array.from(map.values()).sort((a, b) => b.score - a.score);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: ["qiita","hatena"],
    strict: STRICT_BOOK_ONLY,
    ranking,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    `Updated ranking.json (books only=${STRICT_BOOK_ONLY})`,
    `items=${feedItems.length}`,
    `candidates=${candidates.length}`,
    `books=${ranking.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
