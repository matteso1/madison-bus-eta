import { useState } from 'react';
import MapView from './components/MapView';
import PipelineStats from './components/PipelineStats';
import { BarChart3 } from 'lucide-react';

function App() {
  const [showStats, setShowStats] = useState(false);

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
      <MapView />

      {/* Stats Toggle Button */}
      <button
        onClick={() => setShowStats(!showStats)}
        className="fixed bottom-4 left-4 p-3 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 rounded-xl backdrop-blur-sm transition-colors z-40 flex items-center gap-2 shadow-lg"
      >
        <BarChart3 className="w-5 h-5 text-emerald-400" />
        <span className="text-sm text-zinc-300 hidden sm:inline">Pipeline Stats</span>
      </button>

      {/* Stats Panel */}
      <PipelineStats isOpen={showStats} onClose={() => setShowStats(false)} />
    </div>
  );
}

export default App;
