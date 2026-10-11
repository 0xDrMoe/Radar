export default function RadarMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M11,11 L6.1,4 A8.5,8.5 0 0,1 15.9,4 Z" fill="var(--coral)" opacity="0.12" />
      <circle cx="11" cy="11" r="8.5" stroke="var(--coral)" strokeWidth="1.3" opacity="0.35" />
      <circle cx="11" cy="11" r="5" stroke="var(--coral)" strokeWidth="1.3" opacity="0.7" />
      <circle cx="11" cy="11" r="1.3" fill="var(--coral)" />
      <circle cx="14.6" cy="5.1" r="2.6" stroke="var(--coral)" strokeWidth="1" opacity="0.35" />
      <circle cx="14.6" cy="5.1" r="1.4" fill="var(--coral)" />
    </svg>
  );
}
