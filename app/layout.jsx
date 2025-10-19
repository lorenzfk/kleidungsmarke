import './globals.css';
import AppChrome from '@/components/AppChrome';

export const metadata = {
  title: 'kleidungsmarke',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <AppChrome title="Shop" />
        {children}
      </body>
    </html>
  );
}
