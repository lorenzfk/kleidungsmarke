// app/cart/page.jsx
import CartClient from '@/components/CartClient';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';
export default function Page() {
  return <CartClient />;
}
