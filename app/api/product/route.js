// app/api/product/route.js
import { NextResponse } from 'next/server';
import { getProductByHandle } from '@/lib/shopify'; // if '@' alias isn't set, use: '../../../lib/shopify'

export const runtime = 'edge';
export const dynamic = 'force-dynamic'; // don't cache in the App Router

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const handle = searchParams.get('handle');
  if (!handle) {
    return NextResponse.json({ error: 'Missing handle' }, { status: 400 });
  }

  // Use the SAME env names your lib uses
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;

  if (!domain || !token) {
    return NextResponse.json(
      {
        error: 'Shopify env missing',
        debug: {
          hasDomain: !!domain,
          hasToken: !!token,
          expected: [
            'SHOPIFY_STORE_DOMAIN or NEXT_PUBLIC_SHOPIFY_DOMAIN',
            'SHOPIFY_STOREFRONT_TOKEN',
          ],
        },
      },
      { status: 500 }
    );
  }

  try {
    const product = await getProductByHandle(handle);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json(
      { product },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'Shopify fetch failed', message: String(err?.message || err) },
      { status: 502 }
    );
  }
}
