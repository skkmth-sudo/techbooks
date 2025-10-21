import data from "@/app/data/ranking.json";
export function GET() {
  const count = Array.isArray((data as any).ranking) ? (data as any).ranking.length : 0;
  return Response.json({ ok: true, hasRanking: count > 0, count, generatedAt: (data as any).generatedAt ?? null });
}
