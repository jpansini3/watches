import { chartSeries, formatMoney, type PriceRow } from "@/lib/money";

const COLORS = {
  retail: "#1c1915",
  chrono24: "#8a6232",
};

function formatAxisDate(iso: string, withYear: boolean): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

function compactAxis(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    const scaled = dollars / 1000;
    const digits = scaled >= 10 ? 0 : 1;
    return `$${scaled.toFixed(digits)}k`;
  }
  return formatMoney(Math.round(cents));
}

export function PriceChart({ prices }: { prices: PriceRow[] }) {
  const retail = chartSeries(prices, "retail");
  const chrono24 = chartSeries(prices, "chrono24");
  const dates = [...new Set([...retail, ...chrono24].map((point) => point.date))].sort();
  if (dates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Record a retail or Chrono24 price to see it over time.
      </p>
    );
  }

  const width = 640;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 36, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = [...retail, ...chrono24].map((point) => point.cents);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  const padValue = span === 0 ? Math.max(rawMax * 0.08, 100) : span * 0.12;
  const min = Math.max(0, rawMin - padValue);
  const max = rawMax + padValue;
  const range = max - min || 1;
  const indexOf = new Map(dates.map((date, index) => [date, index]));
  const x = (date: string) => {
    const index = indexOf.get(date) ?? 0;
    return pad.left + (dates.length <= 1 ? innerW / 2 : (index / (dates.length - 1)) * innerW);
  };
  const y = (cents: number) => pad.top + ((max - cents) / range) * innerH;
  const years = new Set(dates.map((date) => date.slice(0, 4)));
  const withYear = years.size > 1;
  const ticks = 4;
  const labelEvery = dates.length > 8 ? Math.ceil(dates.length / 6) : 1;

  function line(points: { date: string; cents: number }[], color: string) {
    const coords = points.map((point) => `${x(point.date)},${y(point.cents)}`).join(" ");
    return (
      <g key={color}>
        {points.length > 1 ? (
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={coords}
          />
        ) : null}
        {points.map((point) => (
          <circle key={`${color}-${point.date}`} cx={x(point.date)} cy={y(point.cents)} r="3.5" fill={color}>
            <title>{`${formatAxisDate(point.date, true)} ${formatMoney(point.cents)}`}</title>
          </circle>
        ))}
      </g>
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Price over time">
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const value = min + (range * index) / ticks;
          const py = y(value);
          return (
            <g key={index}>
              <line x1={pad.left} x2={width - pad.right} y1={py} y2={py} stroke="#d9cebc" strokeWidth="1" />
              <text x={pad.left - 8} y={py + 3} textAnchor="end" fill="#6f675c" fontSize="10">
                {compactAxis(value)}
              </text>
            </g>
          );
        })}
        {line(retail, COLORS.retail)}
        {line(chrono24, COLORS.chrono24)}
        {dates.map((date, index) =>
          index % labelEvery === 0 || index === dates.length - 1 ? (
            <text
              key={date}
              x={x(date)}
              y={height - 8}
              textAnchor="middle"
              fill="#6f675c"
              fontSize="10"
            >
              {formatAxisDate(date, withYear)}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: COLORS.retail }} />
          New
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: COLORS.chrono24 }} />
          Chrono24
        </li>
      </ul>
    </div>
  );
}
