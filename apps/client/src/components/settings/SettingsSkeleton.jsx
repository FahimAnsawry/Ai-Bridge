import React from 'react';

const GLASS_STYLE = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.045) 100%)',
  backdropFilter: 'blur(22px)',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 48px rgba(11,8,38,0.26)',
};

const CARD_THEMES = {
  activeModel: {
    background: 'linear-gradient(135deg, #172554 0%, #312e81 52%, #1e1b4b 100%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 48px rgba(15,23,42,0.45)',
  },
  todayTokens: {
    background: 'linear-gradient(135deg, #064e3b 0%, #115e59 48%, #164e63 100%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 48px rgba(6,78,59,0.4)',
  },
};

const SkeletonPulse = ({ className = '', style = {} }) => (
  <div
    className={`animate-pulse bg-white/10 rounded-lg ${className}`}
    style={style}
  />
);

const ProviderCardSkeleton = () => (
  <div className="rounded-2xl border border-white/20 bg-slate-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] p-4 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 space-y-2">
        <SkeletonPulse className="h-4 w-32" />
        <SkeletonPulse className="h-3 w-48" />
      </div>
      <SkeletonPulse className="h-8 w-8 rounded-lg" />
    </div>

    <div className="flex items-center gap-3">
      <SkeletonPulse className="h-5 w-16" />
      <SkeletonPulse className="h-3 w-1" />
      <SkeletonPulse className="h-5 w-20" />
      <SkeletonPulse className="h-3 w-1" />
      <SkeletonPulse className="h-5 w-24" />
    </div>

    <div className="flex items-center gap-2">
      <SkeletonPulse className="h-10 flex-1 rounded-xl" />
      <SkeletonPulse className="h-10 flex-1 rounded-xl" />
    </div>
  </div>
);

const CopilotCardSkeleton = () => (
  <div className="relative overflow-hidden rounded-2xl p-4" style={GLASS_STYLE}>
    <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%)' }} />
    <div className="relative z-10 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <SkeletonPulse className="w-8 h-8 rounded-xl" />
        <div className="space-y-1.5">
          <SkeletonPulse className="h-4 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SkeletonPulse className="h-6 w-24 rounded-full" />
        <SkeletonPulse className="h-4 w-4" />
      </div>
    </div>
  </div>
);

const SettingsSkeleton = () => {
  return (
    <div className="max-w-7xl mx-auto h-[calc(100vh-165px)] max-sm:h-auto flex flex-col pt-2 lg:py-6 px-4 sm:px-6 lg:px-10 overflow-hidden max-sm:overflow-visible">
      <header className="shrink-0 space-y-1 sm:space-y-2 pb-1 sm:pb-2 border-b border-white/15">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <SkeletonPulse className="h-10 w-64" />
            <SkeletonPulse className="h-4 w-96" />
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-8 overflow-hidden max-sm:overflow-visible pb-4 pt-2 min-h-0">
        <div className="lg:col-span-6 flex-1 flex flex-col min-h-0 overflow-hidden max-sm:min-h-0 max-sm:flex-none">
          <div className="relative overflow-hidden rounded-2xl p-5 lg:p-6 flex-1 flex flex-col min-h-0" style={CARD_THEMES.activeModel}>
            <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%)' }} />
            <div className="relative z-10 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-center gap-3">
                  <SkeletonPulse className="w-5 h-5 rounded" />
                  <SkeletonPulse className="h-5 w-32" />
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-0 overflow-hidden max-sm:flex-none space-y-4">
                <div className="shrink-0 space-y-3">
                  <SkeletonPulse className="h-3 w-40" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <CopilotCardSkeleton />
                    </div>
                  </div>
                </div>

                <div className="shrink-0 flex items-center justify-between gap-3 pt-3 border-t border-white/15">
                  <SkeletonPulse className="h-3 w-36" />
                  <SkeletonPulse className="h-8 w-20 rounded-full" />
                </div>

                <div className="flex-1 min-h-0 mt-3 max-sm:flex-none">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ProviderCardSkeleton />
                    <ProviderCardSkeleton />
                    <ProviderCardSkeleton />
                    <ProviderCardSkeleton />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 flex-1 flex flex-col space-y-6 overflow-hidden min-h-0">
          <div className="relative overflow-hidden rounded-2xl p-5 lg:p-6 flex-1 flex flex-col min-h-0" style={CARD_THEMES.todayTokens}>
            <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%)' }} />
            <div className="relative z-10 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-3 shrink-0 mb-5">
                <div className="flex items-center gap-3">
                  <SkeletonPulse className="w-5 h-5 rounded" />
                  <SkeletonPulse className="h-5 w-28" />
                </div>
                <SkeletonPulse className="h-6 w-20 rounded-full" />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 border-t border-white/15 pt-5">
                <div className="rounded-2xl border border-white/20 bg-slate-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] p-4">
                  <div className="flex items-start gap-3">
                    <SkeletonPulse className="mt-0.5 h-9 w-9 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <SkeletonPulse className="h-3 w-20" />
                      <div className="flex items-center gap-2">
                        <SkeletonPulse className="h-10 flex-1 rounded-xl" />
                        <SkeletonPulse className="h-10 w-10 rounded-xl" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/20 bg-slate-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] p-4">
                  <div className="flex items-start gap-3">
                    <SkeletonPulse className="mt-0.5 h-9 w-9 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <SkeletonPulse className="h-3 w-24" />
                      <div className="flex items-center gap-2">
                        <SkeletonPulse className="h-10 flex-1 rounded-xl" />
                        <SkeletonPulse className="h-10 w-10 rounded-xl" />
                        <SkeletonPulse className="h-10 w-10 rounded-xl" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSkeleton;
