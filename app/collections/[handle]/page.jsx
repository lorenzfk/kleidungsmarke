// app/collections/[handle]/page.jsx
import { notFound } from 'next/navigation';
import CollectionClient from '@/components/CollectionClient';
import { getCollectionItems } from '@/lib/catalog';

export const runtime = 'edge';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

function stripHtml(html) {
  try { return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}

export async function generateMetadata(props) {
  const params = await props.params;
  const handleRaw = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const handle = (typeof handleRaw === 'string' && handleRaw.trim()) ? handleRaw.trim() : null;
  if (!handle) return {};
  const data = await getCollectionItems(handle);
  const title = `${data.title} – Kollektion – Kleidungsmarke`;
  const description = (stripHtml(data.description) || stripHtml(data.descriptionHtml) || '').slice(0, 160);
  const canonical = `${SITE_URL.replace(/\/$/, '')}/collections/${encodeURIComponent(handle)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: { title, description },
  };
}

export const dynamic = 'force-dynamic';

export default async function CollectionPage(props) {
  // Next 15: await dynamic APIs
  const params = await props.params;

  const handleRaw = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const handle = (typeof handleRaw === 'string' && handleRaw.trim()) ? handleRaw.trim() : null;

  if (!handle) notFound();

  const {
    title,
    description = '',
    descriptionHtml = '',
    items,
  } = await getCollectionItems(handle);

  const canonical = `${SITE_URL.replace(/\/$/, '')}/collections/${encodeURIComponent(handle)}`;
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Startseite', item: SITE_URL.replace(/\/$/, '') },
      { '@type': 'ListItem', position: 2, name: 'Kollektionen', item: `${SITE_URL.replace(/\/$/, '')}/collections` },
      { '@type': 'ListItem', position: 3, name: title, item: canonical },
    ],
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    <CollectionClient
      title={title}
      description={description}
      descriptionHtml={descriptionHtml}
      items={items}
    />
  </>;
}
