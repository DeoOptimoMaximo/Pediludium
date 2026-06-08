'use client';
import { useRouter } from 'next/navigation';

export function BackButton({ label = '← Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <a
      className="muted small"
      style={{ cursor: 'pointer' }}
      onClick={() => router.back()}
    >
      {label}
    </a>
  );
}
