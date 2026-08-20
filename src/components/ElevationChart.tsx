import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { DistanceUnit, ElevationPoint, RouteStats } from '../types/route';
import { Activity, ArrowDownRight, ArrowUpRight, Mountain, TrendingUp } from 'lucide-react';

interface ElevationChartProps {
  profile: ElevationPoint[];
  stats: RouteStats;
  unit: DistanceUnit;
  onHoverPoint: (point: ElevationPoint | null) => void;
  hoveredPoint: ElevationPoint | null;
}

export const ElevationChart: React.FC<ElevationChartProps> = ({
  profile,
  stats,
  unit,
  onHoverPoint,
  hoveredPoint,
}) => {
  if (!profile || profile.length === 0) {
    return (
      <div className="w-full h-44 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-center text-slate-500 text-xs">
        Generate a route to visualize terrain elevation profile & gradient telemetry.
      </div>
    );
  }

  // Calculate dynamic min/max for chart Y axis padding
  const minEle = Math.max(0, stats.lowestPointM - 10);
  const maxEle = stats.highestPointM + 15;

  return (
    <div
      id="elevation-profile-panel"
      className="w-full rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 backdrop-blur-md shadow-xl flex flex-col gap-3"
    >
      {/* Top telemetry metric bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Mountain className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Elevation Profile
            </h4>
            <p className="text-[11px] text-slate-400">
              Interactive distance-synced topography
            </p>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex items-center gap-2 sm:gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-300">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400 text-[11px]">Gain:</span>
            <span className="font-semibold text-emerald-400">+{stats.elevationGainM}m</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-300">
            <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-slate-400 text-[11px]">Loss:</span>
            <span className="font-semibold text-rose-400">-{stats.elevationLossM}m</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-300">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400 text-[11px]">Max:</span>
            <span className="font-semibold text-cyan-300">{stats.highestPointM}m</span>
          </div>
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div className="w-full h-36 relative">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={profile}
            margin={{ top: 8, right: 10, left: -18, bottom: 0 }}
            onMouseMove={(state: any) => {
              if (state && state.activePayload && state.activePayload.length > 0) {
                const pt = state.activePayload[0].payload as ElevationPoint;
                onHoverPoint(pt);
              }
            }}
            onMouseLeave={() => onHoverPoint(null)}
          >
            <defs>
              <linearGradient id="elevationGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#064e3b" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="distance"
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              unit={unit}
              interval="preserveStartEnd"
            />

            <YAxis
              domain={[minEle, maxEle]}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              unit="m"
              width={38}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as ElevationPoint;
                  return (
                    <div className="p-2.5 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl backdrop-blur-md text-xs font-mono">
                      <div className="flex items-center justify-between gap-4 text-emerald-400 font-bold mb-1">
                        <span>Elevation:</span>
                        <span>{data.elevation} m</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-slate-300">
                        <span>Distance:</span>
                        <span>{data.distance} {unit}</span>
                      </div>
                      {data.grade !== undefined && (
                        <div className="flex items-center justify-between gap-4 text-slate-400 mt-1 pt-1 border-t border-slate-800 text-[10px]">
                          <span>Incline Grade:</span>
                          <span className={data.grade > 3 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                            {data.grade}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />

            {hoveredPoint && (
              <ReferenceLine
                x={hoveredPoint.distance}
                stroke="#38bdf8"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
            )}

            <Area
              type="monotone"
              dataKey="elevation"
              stroke="#10b981"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#elevationGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
