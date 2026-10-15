"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "#fff",
  border: "1px solid #d7e3e6",
  borderRadius: 12,
  fontSize: 12,
};

export function TrendChart({ data }: { data: Array<Record<string, string | number>> }) {
  const keys = Object.keys(data[0] ?? {}).filter((k) => k !== "date");
  const colors = ["#0b4a56", "#d4a017", "#1b6f9a", "#0c8a62", "#c53d3d", "#7a5a08"];
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#e8eef0" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProfitBars({ data }: { data: Array<{ name: string; profit: number; cost: number; market: number }> }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid stroke="#e8eef0" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={58} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Bar dataKey="cost" name="Coût" fill="#8aa0a6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="market" name="Marché" fill="#1b6f9a" radius={[4, 4, 0, 0]} />
          <Bar dataKey="profit" name="Bénéfice" fill="#0c8a62" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({ data }: { data: Array<{ bucket: string; count: number }> }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid stroke="#e8eef0" strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Nombre" fill="#0b4a56" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ActivityArea({ data }: { data: Array<{ date: string; changes: number; discoveries: number }> }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid stroke="#e8eef0" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Area type="monotone" dataKey="changes" name="Changements de prix" stroke="#d4a017" fill="#f3dd9a" />
          <Area type="monotone" dataKey="discoveries" name="Nouveaux produits" stroke="#0b4a56" fill="#b7d4da" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const SERIES_FR: Record<string, string> = { purchase: "Prix d'achat", selling: "Notre prix", recommended: "Prix recommandé" };

export function HistoryChart({
  data,
}: {
  data: Array<{ date: string; purchase?: number; selling?: number; recommended?: number; [k: string]: string | number | undefined }>;
}) {
  const keys = Object.keys(data[0] ?? {}).filter((k) => k !== "date");
  const color: Record<string, string> = {
    purchase: "#8aa0a6",
    selling: "#0b4a56",
    recommended: "#d4a017",
  };
  const palette = ["#1b6f9a", "#0c8a62", "#c53d3d", "#7a5a08", "#14606e"];
  let extra = 0;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#e8eef0" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          {keys.map((k) => {
            const stroke = color[k] ?? palette[extra++ % palette.length];
            return <Line key={k} type="monotone" dataKey={k} name={SERIES_FR[k] ?? k} stroke={stroke} dot={false} strokeWidth={k === "recommended" ? 2 : 1.8} strokeDasharray={k === "purchase" ? "4 4" : undefined} />;
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
