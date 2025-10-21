// app/api/health/route.ts
import raw from "@/app/data/ranking.json";

// 最低限の型
type Source = {
  qiitaId?: string;
  url: string;
  title: string;
  likes?: number;
  stocks?: number;
};
type BookAgg = {
  id: string;
  title: string;
  asin?: string;
  isbn?: string;
  mentions?: number;
  score?: number;
  totalLikes?: number;
  totalStocks?: number;
  sources?: Source[];
};
type RankingData = {
  generatedAt?: string | null;
  ranking?: BookAgg[];
};

// type guard
function isRankingData(x: unknown): x is RankingData {
  if (typeof x !== "object" || x === null) return false;
  const o = x as { ranking?: unknown };
  if (o.ranking !== undefined && !Array.isArray(o.ranking)) return false;
  return true;
}

export async function GET() {
  const data: RankingData = isRankingData(raw) ? raw : {};
  const count = Array.isArray(data.ranking) ? data.ranking.length : 0;

  return Response.json(
    {
      ok: true,
      hasRanking: count > 0,
      count,
      generatedAt: data.generatedAt ?? null,
    },
    { status: 200 }
  );
}
