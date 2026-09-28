/** Marca: perfil de bardas sobre un horizonte, en terracota. Decorativa junto al nombre. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="oklch(0.553 0.175 40)" />
      <path d="M4 22 L10 14 L14 18 L19 10 L28 22 Z" fill="oklch(0.98 0.01 80)" opacity="0.95" />
      <rect x="4" y="23.5" width="24" height="2" rx="1" fill="oklch(0.98 0.01 80)" opacity="0.6" />
    </svg>
  );
}
