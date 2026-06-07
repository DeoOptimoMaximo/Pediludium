'use client';
import { useEffect, useState } from 'react';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

export function Countdown({ toIso }: { toIso: string }) {
  const target = new Date(toIso).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const p = parts(target - now);
  return (
    <div className="countdown">
      {([['d', p.d], ['h', p.h], ['m', p.m], ['s', p.s]] as const).map(([k, v]) => (
        <div className="cd-box" key={k}>
          <b>{String(v).padStart(2, '0')}</b>
          <span className="small muted">{k.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}
