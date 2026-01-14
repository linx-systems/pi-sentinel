interface StatsCardProps {
  label: string;
  value: string;
  className?: string;
}

export function StatsCard({ label, value, className }: StatsCardProps) {
  return (
    <div class="stat-card">
      <div class="label">{label}</div>
      <div class={`value ${className || ''}`}>{value}</div>
    </div>
  );
}
