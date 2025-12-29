import React from 'react';
import MapView from './components/MapView';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
      <MapView />
      <Dashboard />
    </div>
  );
}

export default App;
