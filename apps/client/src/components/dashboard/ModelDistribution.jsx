import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { Box } from 'lucide-react';

const RADIAN = Math.PI / 180;

const formatName = (name = '', max = 24) => (String(name).length > max ? `${String(name).slice(0, max - 2)}...` : name);

const CustomLabel = ({ cx, cy, midAngle, outerRadius, percent, name, requests }) => {
  if (percent < 0.05) return null;
  const sin = Math.sin(-midAngle * RADIAN);
  const cos = Math.cos(-midAngle * RADIAN);
  const startX = cx + outerRadius * cos;
  const startY = cy + outerRadius * sin;
  const midX = cx + (outerRadius + 14) * cos;
  const midY = cy + (outerRadius + 14) * sin;
  const endX = midX + (cos >= 0 ? 40 : -40);
  const textAnchor = cos >= 0 ? 'start' : 'end';
  const labelX = endX + (cos >= 0 ? 7 : -7);
  const isMajorSlice = percent >= 0.12;
  const label = `${formatName(name)} ${(percent * 100).toFixed(1)}% (${requests})`;

  return (
    <g>
      <path
        d={`M${startX},${startY}L${midX},${midY}L${endX},${midY}`}
        fill="none"
        stroke="rgba(214,218,255,0.75)"
        strokeWidth={1.2}
      />
      <text
        x={labelX}
        y={midY}
        fill="#FFFFFF"
        textAnchor={textAnchor}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
      >
        {isMajorSlice ? (
          <>
            <tspan x={labelX} dy="-0.45em">{formatName(name, 19)}</tspan>
            <tspan x={labelX} dy="1.15em">{`${(percent * 100).toFixed(1)}% (${requests})`}</tspan>
          </>
        ) : label}
      </text>
    </g>
  );
};

const COLORS = ['#6366f1', '#10b981', '#a855f7', '#fb7185', '#22d3ee', '#fbbf24', '#818cf8', '#34d399'];

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

const ModelDistribution = ({ data = [], loading = false }) => {
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <div
        className="relative h-full p-5 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-bg-panel)',
          border: '1px solid var(--color-glass-border)',
          height: 330,
        }}
      />
    );
  }

  const GLASS = {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
    backdropFilter: 'blur(22px)',
    border: '1px solid rgba(255,255,255,0.22)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="relative h-[20rem] lg:h-full rounded-2xl overflow-hidden flex flex-col px-5 py-4"
      style={GLASS}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 55%)' }} />

      <div className="relative z-10 mb-1 shrink-0">
        <h3 className="text-[13px] font-black uppercase tracking-[0.02em]" style={{ color: '#FFFFFF' }}>Model Distribution</h3>
      </div>

      {data.length === 0 ? (
        <div className="relative z-10 flex flex-col items-center justify-center flex-1 gap-3">
          <div
            className="h-12 w-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)' }}
          >
            <Box size={22} style={{ color: '#a855f7' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: '#726D97' }}>
            No model distribution data yet.
          </p>
        </div>
      ) : (
        <div className="relative z-10 min-h-0 min-w-0 flex-1 flex flex-col justify-between">
          <div className={`${isMobile ? 'h-[160px]' : 'h-full min-h-[210px]'} min-w-0 w-full`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart margin={isMobile ? { top: 4, right: 10, bottom: 4, left: 10 } : { top: 8, right: 130, bottom: 8, left: 130 }}>
                <Pie
                  data={data}
                  cx="50%"
                  cy={isMobile ? "50%" : "54%"}
                  innerRadius={0}
                  outerRadius={isMobile ? "80%" : "62%"}
                  paddingAngle={0}
                  dataKey="requests"
                  labelLine={false}
                  label={isMobile ? null : CustomLabel}
                  isAnimationActive={false}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color || COLORS[index % COLORS.length]}
                      stroke="rgba(20,18,70,0.88)"
                      strokeWidth={1}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {isMobile && (
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] font-semibold max-h-[64px] overflow-y-auto custom-scrollbar">
              {data.map((item, idx) => (
                <div key={item.name} className="flex items-center gap-1 text-white/90">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate max-w-[90px]">{item.name}</span>
                  <span className="text-white/50">({item.percentage.toFixed(0)}%)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default ModelDistribution;
