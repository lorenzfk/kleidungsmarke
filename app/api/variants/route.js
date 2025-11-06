import { shopifyFetch } from '@/lib/shopify';

export const runtime = 'edge';
export async function POST(req) {
  const { ids } = await req.json();

  if (!Array.isArray(ids) || !ids.length) {
    return Response.json({ variants: [] });
  }

  const QUERY = /* GraphQL */ `
    query VariantNodes($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on ProductVariant {
          id
          title
          price { amount currencyCode }
          product { title handle featuredImage { url } }
        }
      }
    }
  `;

  const data = await shopifyFetch(QUERY, { ids });

  const variants = (data?.nodes || [])
    .filter(n => n?.__typename === 'ProductVariant')
    .map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      product: {
        title: v.product?.title || '',
        handle: v.product?.handle || '',
        image: v.product?.featuredImage?.url || null,
      },
    }));

  return Response.json({ variants });
}
