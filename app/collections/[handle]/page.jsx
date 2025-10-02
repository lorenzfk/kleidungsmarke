// app/collections/[handle]/page.jsx
import { notFound } from 'next/navigation';
import CollectionClient from '@/components/CollectionClient';
import { getCollectionItems } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function CollectionPage(props) {
  // Next 15: await dynamic APIs
  const params = await props.params;

  const handleRaw = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const handle = (typeof handleRaw === 'string' && handleRaw.trim()) ? handleRaw.trim() : null;

  if (!handle) notFound();

  const { title, items } = await getCollectionItems(handle);
  return <CollectionClient title={title} items={items} />;
}
