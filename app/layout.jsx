import './globals.css';
import AppChrome from '@/components/AppChrome';
import ViewportHeightFix from '@/components/ViewportHeightFix';
import ZoomBlocker from '@/components/ZoomBlocker';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Kleidungsmarke',
    template: '%s | Kleidungsmarke',
  },
  description: 'Kleidungsmarke – hochwertige Kleidung, fair produziert. Entdecke neue Kollektionen, Hoodies, Shirts und mehr.',
  applicationName: 'Kleidungsmarke',
  icons: { icon: '/favicon.png' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Kleidungsmarke',
    locale: 'de_DE',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@kleidungsmarke',
    creator: '@kleidungsmarke',
  },
  alternates: { canonical: SITE_URL },
};

// Disable zoom site-wide and set viewport
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: 'no',
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <ViewportHeightFix />
        <ZoomBlocker />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Kleidungsmarke',
            url: SITE_URL.replace(/\/$/, ''),
            logo: `${SITE_URL.replace(/\/$/, '')}/favicon.png`,
            sameAs: [],
          }) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Kleidungsmarke',
            url: SITE_URL.replace(/\/$/, ''),
            potentialAction: {
              '@type': 'SearchAction',
              target: `${SITE_URL.replace(/\/$/, '')}/search?q={search_term_string}`,
              'query-input': 'required name=search_term_string',
            },
          }) }}
        />
        <AppChrome title="Shop" />
        {children}
      </body>
    </html>
  );
}
