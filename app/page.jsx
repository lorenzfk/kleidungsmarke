// app/page.jsx
import ThreeCatalog from '@/components/ThreeCatalog';
import { getLandingData } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { items, dbg } = await getLandingData();
  return <><ThreeCatalog products={items} debug={dbg} /></>;
}
