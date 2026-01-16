import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MapView from './components/MapView';
import Analytics from './pages/Analytics';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          <div className="w-full h-screen bg-black overflow-hidden relative">
            <MapView />
          </div>
        } />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
