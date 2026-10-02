/** Marca: las montañas del logo de RELEVO (verde, terracota y el claro del medio). Decorativa junto al nombre. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="608 232 384 184" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d="M617 408 L736 240 L793 320 L728 408 Z" fill="#5B6B4E" />
      <path d="M866 240 L983 408 L872 408 L808 320 Z" fill="#C9744F" />
      <path d="M743 408 L800 328 L857 408 Z" fill="#E6CDB5" />
    </svg>
  );
}
