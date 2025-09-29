// components/LogoHomeLink.jsx
import Link from 'next/link';

export default function LogoHomeLink({ className = '' }) {
  return (
    <Link
      href="/"
      aria-label="Zur Startseite"
      className={`logo-home ${className}`}
    >
      <img src="/kleidungsmarke.svg" alt="kleidungsmarke" />
    </Link>
  );
}
