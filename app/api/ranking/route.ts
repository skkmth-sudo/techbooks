import data from "@/app/data/ranking.json";
export function GET() {
  return Response.json(data, { status: 200 });
}
