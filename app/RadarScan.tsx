export default function RadarScan({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="radar-scan">
      <circle cx="20" cy="20" r="17" stroke="var(--coral)" strokeWidth="1.2" opacity="0.22" />
      <circle cx="20" cy="20" r="11" stroke="var(--coral)" strokeWidth="1.2" opacity="0.38" />
      <circle cx="20" cy="20" r="5.5" stroke="var(--coral)" strokeWidth="1.2" opacity="0.55" />
      <g className="radar-scan-sweep">
        <path d="M20,20 L20,3 A17,17 0 0,1 32.2,8.1 Z" fill="var(--coral)" opacity="0.3" />
      </g>
      <circle cx="20" cy="20" r="2.1" fill="var(--coral)" />
    </svg>
  );
}
