// app/api/collection/route.js
import { NextResponse } from 'next/server';
import { getCollectionItems } from '@/lib/catalog';

export const dynamic = 'force-dynamic';         // no caching during dev
export const revalidate = 0;

/**
 * GET /api/collection?handle=<handle>&limit=<n?>
 * Returns: { title, description, descriptionHtml, items }
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const handle = searchParams.get('handle');
    const limitParam = searchParams.get('limit');
    const limit = Number.isFinite(parseInt(limitParam, 10))
      ? Math.max(1, Math.min(50, parseInt(limitParam, 10)))
      : undefined;

    if (!handle) {
      return NextResponse.json({ error: 'Missing "handle"' }, { status: 400 });
    }

    // Reuse your existing server util
    const result = await getCollectionItems(handle, { limit });
    const title = result?.title ?? handle;
    const description = typeof result?.description === 'string' ? result.description : '';
    const descriptionHtml = typeof result?.descriptionHtml === 'string' ? result.descriptionHtml : '';
    const items = Array.isArray(result?.items) ? result.items : (result || []);

    return NextResponse.json(
      { title, description, descriptionHtml, items },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[api/collection] error:', err);
    return NextResponse.json({ error: 'Failed to fetch collection' }, { status: 500 });
  }
}
