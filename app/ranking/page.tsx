import Link from "next/link";
import data from "@/app/data/ranking.json";

export const metadata = { title: "プログラミング参考書ランキング" };

type Source = { url: string; title: string; likes?: number; stocks?: number };
type Book = {
  id: string; title: string; mentions?: number;
  totalLikes?: number; totalStocks?: number; sources?: Source[];
};

export default function RankingPage() {
  const items = (data.ranking as Book[]) ?? [];
  const sorted = [...items].sort(
    (a, b) => (b.totalLikes ?? 0) - (a.totalLikes ?? 0) || (b.mentions ?? 0) - (a.mentions ?? 0)
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
        📚 プログラミング参考書ランキング
      </h1>

      {sorted.length === 0 ? (
        <p style={{ color: "#666" }}>まだデータがありません。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {sorted.map((b, i) => (
            <li key={b.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{i + 1}. {b.title}</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                    👍 {b.totalLikes ?? 0}　🗂️ 言及 {b.mentions ?? 0}
                    {b.totalStocks ? `　⭐ ${b.totalStocks}` : ""}
                  </div>
                </div>
                <Link href={`https://www.amazon.co.jp/s?k=${encodeURIComponent(b.title)}`}
                      target="_blank" style={{ fontSize: 12, padding: "6px 10px",
                      background: "#111827", color: "#fff", borderRadius: 8 }}>
                  Amazonで探す
                </Link>
              </div>

              {(b.sources ?? []).length > 0 && (
                <ul style={{ marginTop: 10 }}>
                  {b.sources!.map((s, idx) => (
                    <li key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: idx ? "1px solid #eee" : "none" }}>
                      <a href={s.url} target="_blank" style={{ textDecoration: "underline" }}>{s.title}</a>
                      <span>👍 {s.likes ?? 0}{s.stocks ? ` / ⭐ ${s.stocks}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
