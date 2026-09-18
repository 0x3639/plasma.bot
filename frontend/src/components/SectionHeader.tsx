interface SectionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

/** `[ SECTION_NAME ]` style heading used between page sections. */
export function SectionHeader({ children, className = '' }: SectionHeaderProps) {
  return <h2 className={`text-[13px] font-bold text-ink ${className}`}>{children}</h2>;
}
