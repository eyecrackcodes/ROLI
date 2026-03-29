import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartData = Array<Record<string, any>>;

interface TrendLineProps {
  data: ChartData;
  xKey: string;
  lines: Array<{ key: string; color: string; name: string; yAxisId?: string }>;
  height?: number;
  dualAxis?: boolean;
  className?: string;
}

export function TrendLineChart({ data, xKey, lines, height = 280, dualAxis, className }: TrendLineProps) {
  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
          {dualAxis && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />}
          <Tooltip
            contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
            labelStyle={{ color: "#e2e8f0" }}
            itemStyle={{ color: "#e2e8f0" }}
          />
          <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8" }} />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              yAxisId={line.yAxisId ?? "left"}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TrendBarProps {
  data: ChartData;
  xKey: string;
  bars: Array<{ key: string; color: string; name: string }>;
  height?: number;
  className?: string;
}

export function TrendBarChart({ data, xKey, bars, height = 280, className }: TrendBarProps) {
  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
          <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
            labelStyle={{ color: "#e2e8f0" }}
            itemStyle={{ color: "#e2e8f0" }}
          />
          <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8" }} />
          {bars.map((bar) => (
            <Bar key={bar.key} dataKey={bar.key} name={bar.name} fill={bar.color} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({ data, color = "#60a5fa", width = 80, height = 24 }: SparklineProps) {
  if (data.length < 2) return <span className="text-[10px] font-mono text-muted-foreground">---</span>;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

export function DeltaBadge({ value, format = "number", invert = false }: { value: number | null; format?: "number" | "currency"; invert?: boolean }) {
  if (value === null) return <span className="text-[10px] font-mono text-muted-foreground">---</span>;

  const isPositive = value > 0;
  const arrow = isPositive ? "\u25B2" : value < 0 ? "\u25BC" : "\u2014";
  const formatted = format === "currency"
    ? `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : Math.abs(value).toString();

  const goodUp = invert ? !isPositive : isPositive;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11px] font-mono font-bold",
      value === 0 ? "text-muted-foreground" : goodUp ? "text-emerald-400" : "text-red-400"
    )}>
      {arrow} {formatted}
    </span>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div style={{ height }} className="flex items-center justify-center border border-dashed border-border rounded-md bg-card/30">
      <p className="text-xs font-mono text-muted-foreground">No trend data available</p>
    </div>
  );
}
