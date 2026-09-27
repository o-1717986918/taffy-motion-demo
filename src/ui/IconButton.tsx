import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  compact?: boolean;
  active?: boolean;
}

export function IconButton({ icon, label, compact, active, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${compact ? "icon-button--compact" : ""} ${active ? "is-active" : ""} ${className}`}
      title={props.title ?? label}
      aria-label={props["aria-label"] ?? label}
      aria-pressed={active}
      {...props}
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  );
}
