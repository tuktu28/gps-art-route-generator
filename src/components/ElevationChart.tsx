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
      <div className="w-full h-44 rounded-2xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] flex items-center justify-center text-stone-400 dark:text-stone-500 text-xs shadow-sm">
        Generate a route to visualize terrain elevation profile & topography telemetry.
      </div>
    );
  }

  // Calculate dynamic min/max for chart Y axis padding
  const minEle = Math.max(0, stats.lowestPointM - 10);
  const maxEle = stats.highestPointM + 15;

  return (
    <div
      id="elevation-profile-panel"
      className="w-full rounded-2xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] p-4 shadow-sm flex flex-col gap-3 transition-colors"
    >
      {/* Top telemetry metric bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5DFD3] dark:border-[#2E3C34] pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 text-[#2D4F3E] dark:text-[#7EB89B] border border-[#2D4F3E]/20">
            <Mountain className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
              Elevation Profile
            </h4>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Interactive distance-synced topography
            </p>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex items-center gap-2 sm:gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300">
            <ArrowUpRight className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
            <span className="text-stone-500 text-[11px]">Gain:</span>
            <span className="font-semibold text-[#2D4F3E] dark:text-[#7EB89B]">+{stats.elevationGainM}m</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300">
            <ArrowDownRight className="w-3.5 h-3.5 text-[#C86432]" />
            <span className="text-stone-500 text-[11px]">Loss:</span>
            <span className="font-semibold text-[#C86432]">-{stats.elevationLossM}m</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300">
            <TrendingUp className="w-3.5 h-3.5 text-[#8C6838]" />
            <span className="text-stone-500 text-[11px]">Max:</span>
            <span className="font-semibold text-[#8C6838]">{stats.highestPointM}m</span>
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
                <stop offset="5%" stopColor="#2D4F3E" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2D4F3E" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="distance"
              tickLine={false}
              axisLine={{ stroke: '#D8D2C4' }}
              tick={{ fill: '#8C857B', fontSize: 10, fontFamily: 'monospace' }}
              unit={unit}
              interval="preserveStartEnd"
            />

            <YAxis
              domain={[minEle, maxEle]}
              tickLine={false}
              axisLine={{ stroke: '#D8D2C4' }}
              tick={{ fill: '#8C857B', fontSize: 10, fontFamily: 'monospace' }}
              unit="m"
              width={38}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as ElevationPoint;
                  return (
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-xl text-xs font-mono">
                      <div className="flex items-center justify-between gap-4 text-[#2D4F3E] dark:text-[#7EB89B] font-bold mb-1">
                        <span>Elevation:</span>
                        <span>{data.elevation} m</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-stone-600 dark:text-stone-300">
                        <span>Distance:</span>
                        <span>{data.distance} {unit}</span>
                      </div>
                      {data.grade !== undefined && (
                        <div className="flex items-center justify-between gap-4 text-stone-500 mt-1 pt-1 border-t border-[#E5DFD3] dark:border-[#2E3C34] text-[10px]">
                          <span>Incline Grade:</span>
                          <span className={data.grade > 3 ? 'text-[#C86432] font-bold' : 'text-stone-600 dark:text-stone-400'}>
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
                stroke="#C86432"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
            )}

            <Area
              type="monotone"
              dataKey="elevation"
              stroke="#2D4F3E"
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
