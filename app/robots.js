const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

export default function robots() {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
    ],
    sitemap: `${SITE_URL.replace(/\/$/, '')}/sitemap.xml`,
    host: SITE_URL.replace(/\/$/, ''),
  };
}

