import { getMainpageData } from '@/lib/mainpage';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rechtliches und Impressum.',
  description: 'Kleidungsmarke – Rechtliches und Impressum.',
};

export default async function LegalPage() {
  const { legalFulltext } = await getMainpageData();
  const hasContent = !!legalFulltext;

  return (
    <div className="legal-page">
      <div className="container" style={{ maxWidth: 680, paddingTop: 80, paddingBottom: 100 }}>
        <h1 className="legal-title">Rechtliches</h1>
        {hasContent ? (
          <div
            className="legal-text"
            dangerouslySetInnerHTML={{ __html: legalFulltext }}
          />
        ) : (
          <p style={{ color: '#fff' }}>Kein Rechtstext vorhanden.</p>
        )}
      </div>
    </div>
  );
}
