"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { ChartPoint } from "@/lib/types";

type MarketChartProps = {
  data: ChartPoint[];
};

export function MarketChart({ data }: MarketChartProps) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="yesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="noGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
          <XAxis dataKey="time" stroke="#7dd3fc" axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} stroke="#94a3b8" axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} />
          <Tooltip
            contentStyle={{
              background: "rgba(9, 14, 32, 0.96)",
              border: "1px solid rgba(56, 189, 248, 0.18)",
              borderRadius: 18,
              color: "#e5f3ff"
            }}
          />
          <Area type="monotone" dataKey="yes" stroke="#38bdf8" strokeWidth={2.6} fill="url(#yesGradient)" />
          <Area type="monotone" dataKey="no" stroke="#8b5cf6" strokeWidth={2.2} fill="url(#noGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
