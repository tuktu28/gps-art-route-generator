import React, { useState } from 'react';
import { SavedRoute, GeneratedRoute } from '../types/route';
import {
  Bookmark,
  Calendar,
  Check,
  Clock,
  Download,
  Edit2,
  Flame,
  Footprints,
  MapPin,
  Mountain,
  Plus,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Saved Routes & GPS Art</h3>
              <p className="text-xs text-slate-400">
                {savedRoutes.length} route{savedRoutes.length === 1 ? '' : 's'} archived in library
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
          {savedRoutes.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-slate-500 gap-2">
              <Route className="w-10 h-10 stroke-1 text-slate-600" />
              <p className="text-sm font-medium text-slate-400">No saved routes yet</p>
              <p className="text-xs max-w-xs text-slate-500">
                Generate standard loops, out-and-backs, or GPS Art words and click "Save Route" to build your library.
              </p>
            </div>
          ) : (
            savedRoutes.map((route) => {
              const isEditing = editingId === route.id;
              return (
                <div
                  key={route.id}
                  className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/90 hover:border-slate-700 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {route.routeType === 'gps_art' ? (
                        <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-400" />
                          GPS ART: {route.gpsArtText}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-semibold uppercase">
                          {route.activity} • {route.routeType === 'loop' ? 'Loop' : 'Out & Back'}
                        </span>
                      )}

                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
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
                          className="px-2.5 py-1 rounded-lg bg-slate-900 border border-emerald-500 text-xs text-white focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => saveRename(route.id)}
                          className="p-1 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <h4 className="text-sm font-bold text-slate-200 truncate">{route.name}</h4>
                        <button
                          onClick={() => startRename(route)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200 transition-opacity p-1"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                      <span className="text-emerald-400 font-bold">{route.stats.distanceKm} km</span>
                      <span>•</span>
                      <span>+{route.stats.elevationGainM}m</span>
                      <span>•</span>
                      <span>~{route.stats.estimatedDurationMinutes} min</span>
                      <span>•</span>
                      <span>{route.stats.estimatedCalories} kcal</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                    <button
                      onClick={() => {
                        onSelectRoute(route);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-medium transition-colors"
                    >
                      Load Map
                    </button>

                    <button
                      onClick={() => downloadGpxFile(route)}
                      title="Download .GPX File"
                      className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDeleteRoute(route.id)}
                      title="Delete Route"
                      className="p-2 rounded-lg bg-slate-800/80 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
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
