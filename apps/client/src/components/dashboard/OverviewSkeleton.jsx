import React from 'react';
import { motion } from 'framer-motion';

const OverviewSkeleton = () => {
  return (
    <div className="flex min-h-full flex-col gap-5 overflow-x-hidden lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="shrink-0">
        <div
          className="h-16 rounded-2xl animate-pulse"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        />
      </div>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        <div className="flex min-h-0 flex-col gap-5 lg:h-full">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>

          <div className="grid min-h-[32rem] min-w-0 flex-1 grid-cols-1 gap-4 lg:min-h-0 lg:grid-cols-2">
            <div className="min-h-0 min-w-0">
              <SkeletonChart />
            </div>
            <div className="min-h-0 min-w-0">
              <SkeletonActivityFeed />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SkeletonCard = ({ index }) => (
  <div
    className="relative h-[92px] overflow-hidden rounded-2xl p-3.5 sm:h-[104px] sm:p-5"
    style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.15)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
    }}
  >
    <div className="absolute inset-0 rounded-2xl overflow-hidden">
      <div
        className="absolute inset-0 shimmer"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
          animation: `shimmer 2s infinite linear`,
          animationDelay: `${index * 0.1}s`,
        }}
      />
    </div>

    <div className="relative z-10 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div
          className="h-2 w-20 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        />
        <div
          className="h-6 w-16 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.2)', animationDelay: '0.1s' }}
        />
        <div
          className="h-2 w-24 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.12)', animationDelay: '0.2s' }}
        />
      </div>
      <div
        className="h-10 w-10 shrink-0 rounded-xl animate-pulse"
        style={{ background: 'rgba(255,255,255,0.15)', animationDelay: '0.15s' }}
      />
    </div>
  </div>
);

const SkeletonChart = () => (
  <div
    className="relative h-[20rem] lg:h-full min-h-0 overflow-hidden rounded-2xl"
    style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
      backdropFilter: 'blur(22px)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
    }}
  >
    <div className="absolute inset-0 rounded-2xl overflow-hidden">
      <div
        className="absolute inset-0 shimmer"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
          animation: 'shimmer 2.5s infinite linear',
        }}
      />
    </div>

    <div className="relative z-10 p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div
          className="h-4 w-32 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.2)' }}
        />
        <div
          className="h-3 w-16 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.15)', animationDelay: '0.1s' }}
        />
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 160 160">
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="20"
            />
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="20"
              strokeDasharray="220 220"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="h-3 w-3 rounded-full animate-pulse"
              style={{ background: 'rgba(255,255,255,0.2)', animationDelay: `${i * 0.1}s` }}
            />
            <div
              className="h-3 flex-1 rounded animate-pulse"
              style={{ background: 'rgba(255,255,255,0.12)', animationDelay: `${i * 0.1}s` }}
            />
            <div
              className="h-3 w-12 rounded animate-pulse"
              style={{ background: 'rgba(255,255,255,0.15)', animationDelay: `${i * 0.1}s` }}
            />
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SkeletonActivityFeed = () => (
  <div
    className="relative h-[22rem] lg:h-full min-h-0 overflow-hidden rounded-2xl"
    style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
      backdropFilter: 'blur(22px)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
    }}
  >
    <div className="absolute inset-0 rounded-2xl overflow-hidden">
      <div
        className="absolute inset-0 shimmer"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
          animation: 'shimmer 2.5s infinite linear',
        }}
      />
    </div>

    <div className="relative z-10 px-6 py-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div
          className="h-4 w-32 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.2)' }}
        />
        <div
          className="h-3 w-12 rounded animate-pulse"
          style={{ background: 'rgba(255,255,255,0.15)', animationDelay: '0.1s' }}
        />
      </div>

      <div className="border-t mb-4" style={{ borderColor: 'rgba(255,255,255,0.18)' }} />

      <div className="flex-1 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[32px_30px_minmax(0,1fr)] items-start gap-3"
          >
            <div
              className="h-7 w-7 rounded-lg animate-pulse"
              style={{ background: 'rgba(255,255,255,0.15)', animationDelay: `${i * 0.1}s` }}
            />
            <div
              className="h-6 w-6 rounded-lg animate-pulse"
              style={{ background: 'rgba(255,255,255,0.12)', animationDelay: `${i * 0.1 + 0.05}s` }}
            />
            <div className="min-w-0 space-y-2">
              <div
                className="h-4 rounded animate-pulse"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  width: '70%',
                  animationDelay: `${i * 0.1}s`,
                }}
              />
              <div
                className="h-3 rounded animate-pulse"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  width: '50%',
                  animationDelay: `${i * 0.1 + 0.05}s`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default OverviewSkeleton;
