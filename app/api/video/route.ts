import { NextRequest, NextResponse } from 'next/server';
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[\w-]{11}$/.test(id))
    return NextResponse.json({ error: 'Invalid video' }, { status: 400 });
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } },
    );
    if (!response.ok) throw Error();
    const data = await response.json();
    return NextResponse.json(
      { title: String(data.title).slice(0, 200) },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  } catch {
    return NextResponse.json({ title: `YouTube · ${id}` });
  }
}
