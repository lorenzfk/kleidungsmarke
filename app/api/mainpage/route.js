// app/api/mainpage/route.js
import { getMainpageData } from '@/lib/mainpage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getMainpageData();
    return Response.json(data, { status: 200 });
  } catch (err) {
    console.error('[api/mainpage] fetch failed:', err?.message || err);
    return Response.json({
      greeting: '',
      about: '',
      legalMessage: '',
      legalFulltext: '',
      backgroundUrl: null,
    }, { status: 200 });
  }
}
