import React, { useState } from 'react';
import { SavedRoute, GeneratedRoute } from '../types/route';
import {
  Bookmark,
  Calendar,
  Check,
  Download,
  Edit2,
  Route,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { downloadGpxFile } from '../lib/gpxExporter';

interface SavedRoutesModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedRoutes: SavedRoute[];
  onSelectRoute: (route: GeneratedRoute) => void;
  onDeleteRoute: (id: string) => void;
  onUpdateRoute: (id: string, updates: Partial<SavedRoute>) => void;
}

export const SavedRoutesModal: React.FC<SavedRoutesModalProps> = ({
  isOpen,
  onClose,
  savedRoutes,
  onSelectRoute,
  onDeleteRoute,
  onUpdateRoute,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');

  if (!isOpen) return null;

  const startRename = (route: SavedRoute) => {
    setEditingId(route.id);
    setEditName(route.name);
  };

  const saveRename = (id: string) => {
    if (editName.trim()) {
      onUpdateRoute(id, { name: editName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-3xl bg-[#FAF7F2] dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-2xl flex flex-col overflow-hidden text-stone-800 dark:text-stone-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E5DFD3] dark:border-[#2E3C34] flex items-center justify-between bg-white/70 dark:bg-[#1E2723]/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 text-[#2D4F3E] dark:text-[#7EB89B] border border-[#2D4F3E]/20">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Saved Routes & GPS Art</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {savedRoutes.length} route{savedRoutes.length === 1 ? '' : 's'} archived in library
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#25302A] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
          {savedRoutes.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-stone-400 dark:text-stone-500 gap-2">
              <Route className="w-10 h-10 stroke-1 text-stone-300 dark:text-stone-600" />
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">No saved routes yet</p>
              <p className="text-xs max-w-xs text-stone-500">
                Generate standard loops, out-and-backs, or GPS Art words and click "Save Route" to build your library.
              </p>
            </div>
          ) : (
            savedRoutes.map((route) => {
              const isEditing = editingId === route.id;
              return (
                <div
                  key={route.id}
                  className="p-4 rounded-2xl bg-white dark:bg-[#202924] border border-[#E5DFD3] dark:border-[#2E3C34] hover:border-[#2D4F3E]/40 dark:hover:border-[#3D6B56] shadow-sm transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {route.routeType === 'gps_art' ? (
                        <span className="px-2 py-0.5 rounded-md bg-[#8C6838]/15 dark:bg-[#8C6838]/30 text-[#8C6838] dark:text-[#DFBD84] border border-[#8C6838]/30 text-[10px] font-mono font-bold flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          GPS ART: {route.gpsArtText}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 text-[#2D4F3E] dark:text-[#7EB89B] border border-[#2D4F3E]/20 text-[10px] font-mono font-semibold uppercase">
                          {route.activity} • {route.routeType === 'loop' ? 'Loop' : 'Out & Back'}
                        </span>
                      )}

                      <span className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(route.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2.5 py-1 rounded-lg bg-stone-50 dark:bg-[#19201D] border border-[#2D4F3E] text-xs text-stone-900 dark:text-stone-100 focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => saveRename(route.id)}
                          className="p-1 rounded-lg bg-[#2D4F3E] text-white hover:bg-[#233F31]"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <h4 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">{route.name}</h4>
                        <button
                          onClick={() => startRename(route)}
                          className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-opacity p-1"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs font-mono text-stone-600 dark:text-stone-400">
                      <span className="text-[#2D4F3E] dark:text-[#7EB89B] font-bold">{route.stats.distanceKm} km</span>
                      <span>•</span>
                      <span>+{route.stats.elevationGainM}m</span>
                      <span>•</span>
                      <span>~{route.stats.estimatedDurationMinutes} min</span>
                      <span>•</span>
                      <span>{route.stats.estimatedCalories} kcal</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-[#E5DFD3] dark:border-[#2E3C34]">
                    <button
                      onClick={() => {
                        onSelectRoute(route);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#2D4F3E] hover:bg-[#233F31] text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                    >
                      Load Map
                    </button>

                    <button
                      onClick={() => downloadGpxFile(route)}
                      title="Download .GPX File"
                      className="p-2 rounded-xl bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDeleteRoute(route.id)}
                      title="Delete Route"
                      className="p-2 rounded-xl bg-[#F4EFE6] dark:bg-[#25302A] border border-[#E5DFD3] dark:border-[#2E3C34] text-[#C86432] hover:bg-[#C86432]/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
