import React from 'react';
import {
  BookOpen,
  Compass,
  Download,
  Flame,
  Footprints,
  MapPin,
  Mountain,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';

interface MasterGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MasterGuideModal: React.FC<MasterGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const steps = [
    {
      step: '01',
      title: 'Set Your Starting Point',
      icon: MapPin,
      iconColor: 'text-[#C86432]',
      bgColor: 'bg-[#C86432]/10',
      description:
        'Search any street address, city, or landmark in the search box. You can also click directly on the interactive map or tap the GPS locator button to place your start pin.',
    },
    {
      step: '02',
      title: 'Select Activity & Route Style',
      icon: Footprints,
      iconColor: 'text-[#2D4F3E] dark:text-[#7EB89B]',
      bgColor: 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/20',
      description:
        'Choose Run, Walk, or Road Bike. Select from Loop (circular closed circuit), Point to Point (one-way), Curated Scenic (parks & greenways), or GPS Art (spell words or shapes onto city streets).',
    },
    {
      step: '03',
      title: 'Choose Distance & Terrain',
      icon: Mountain,
      iconColor: 'text-[#D98A3C]',
      bgColor: 'bg-[#D98A3C]/10',
      description:
        'Pick a target distance using the numeric stepper or instant preset chips (5K, 10K, Half Marathon, Marathon). Adjust elevation preference between flat, rolling, or hilly routes.',
    },
    {
      step: '04',
      title: 'Generate & Inspect Profile',
      icon: Zap,
      iconColor: 'text-[#8C6838] dark:text-[#DFBD84]',
      bgColor: 'bg-[#8C6838]/10 dark:bg-[#DFBD84]/20',
      description:
        'Click "Generate Optimal Route". Preview the live route on the map, and hover across the bottom elevation graph to track elevation gains, highest peaks, and climb profiles in real-time.',
    },
    {
      step: '05',
      title: 'Export to GPS Devices',
      icon: Download,
      iconColor: 'text-[#2D4F3E] dark:text-[#7EB89B]',
      bgColor: 'bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/20',
      description:
        'Download the standard .GPX file to import directly into Garmin Connect, Apple Watch, Strava, Wahoo, COROS, or your favorite outdoor navigation app.',
    },
  ];

  const tips = [
    {
      title: 'GPS Art Mode',
      desc: 'Type any word (e.g., "RUN", "HEART", "DOG") to automatically synthesize path geometries onto matching streets.',
    },
    {
      title: 'Interactive Map Pin',
      desc: 'Click anywhere on the map at any time to instantly reposition your starting trailhead.',
    },
    {
      title: 'Elevation Sync',
      desc: 'Move your cursor along the elevation chart below the map to see the exact corresponding location on the route.',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-900/60 dark:bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-3xl bg-[#FAF7F2] dark:bg-[#161D1A] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-2xl flex flex-col overflow-hidden text-stone-800 dark:text-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-[#E5DFD3] dark:border-[#2E3C34] flex items-center justify-between bg-white dark:bg-[#19201D]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#2D4F3E] dark:bg-[#3D6B56] flex items-center justify-center shadow-md text-white">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-serif font-bold text-stone-900 dark:text-stone-50">
                How to Use Wayline
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Quick 5-step guide to generating and exporting your routes
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            id="close-how-to-modal-btn"
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-[#F4EFE6] dark:hover:bg-[#25302A] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with Scroll */}
        <div className="p-5 sm:p-6 overflow-y-auto flex flex-col gap-6">
          {/* Steps List */}
          <div className="flex flex-col gap-3.5">
            {steps.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="p-4 rounded-2xl bg-white dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] flex items-start gap-4 shadow-2xs"
                >
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div className={`p-2 rounded-xl ${item.bgColor} ${item.iconColor}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-bold text-stone-400">
                      {item.step}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-bold text-stone-900 dark:text-stone-100">
                      {item.title}
                    </h4>
                    <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Helpful Tips Card */}
          <div className="p-4 rounded-2xl bg-[#F4EFE6] dark:bg-[#1E2723] border border-[#E5DFD3] dark:border-[#2E3C34] flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#2D4F3E] dark:text-[#7EB89B]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Pro Tips</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {tips.map((tip, idx) => (
                <div key={idx} className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-stone-800 dark:text-stone-200">
                    {tip.title}
                  </span>
                  <span className="text-[10px] text-stone-600 dark:text-stone-400 leading-snug">
                    {tip.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-[#E5DFD3] dark:border-[#2E3C34] flex items-center justify-end bg-white dark:bg-[#19201D]">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#2D4F3E] hover:bg-[#233F31] text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            Got It, Let&apos;s Go
          </button>
        </div>
      </div>
    </div>
  );
};
