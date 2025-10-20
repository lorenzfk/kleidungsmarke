// app/page.jsx
import ThreeCatalog from '@/components/ThreeCatalog';
import { getLandingData } from '@/lib/catalog';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.com';

export const metadata = {
  title: 'Shop - Kleidungsmarke.com',
  description: 'Kleidungsmarke. Die Marke für Kleidungs.',
  alternates: { canonical: SITE_URL },
  openGraph: { url: SITE_URL },
};

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { items, dbg } = await getLandingData();
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Startseite', item: SITE_URL.replace(/\/$/, '') },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    <ThreeCatalog products={items} debug={dbg} />
  </>;
}
