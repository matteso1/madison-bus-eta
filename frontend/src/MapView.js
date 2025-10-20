import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Import heatmap plugin
import 'leaflet.heat';

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Create a custom bus stop icon
const createBusStopIcon = () => {
  return L.divIcon({
    className: 'custom-bus-stop-icon',
    html: '<div style="background-color: #2272b5; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">B</div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10]
  });
};

// Create a custom live bus icon
const createLiveBusIcon = (isDelayed = false) => {
  const color = isDelayed ? '#ff4444' : '#00aa00';
  const animation = isDelayed ? 'pulse 1s infinite' : 'none';
  
  return L.divIcon({
    className: 'custom-live-bus-icon',
    html: `<div style="
      background-color: ${color}; 
      color: white; 
      border-radius: 50%; 
      width: 24px; 
      height: 24px; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 14px; 
      font-weight: bold; 
      border: 3px solid white; 
      box-shadow: 0 3px 6px rgba(0,0,0,0.4);
      animation: ${animation};
    ">B</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const DEFAULT_POS = [43.0731, -89.4012]; // Madison center

// Helper functions for formatting data
const formatPassengerLoad = (load) => {
  switch(load) {
    case 'FULL': return '🟥 Full';
    case 'HALF_EMPTY': return '🟡 Half Full';
    case 'EMPTY': return '🟢 Empty';
    case 'N/A': return '❓ Unknown';
    default: return load;
  }
};

const formatTimestamp = (timestamp) => {
  // Convert from YYYYMMDD HH:MM format to readable time
  if (!timestamp) return 'Unknown';
  
  try {
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const time = timestamp.substring(9);
    
    const date = new Date(`${year}-${month}-${day}T${time}`);
    return date.toLocaleTimeString();
  } catch (e) {
    return timestamp;
  }
};

// Component to auto-fit map to polyline
function FitBounds({ bounds, map }) {
  useEffect(() => {
    if (bounds && bounds.length > 1 && map) {
      map.fitBounds(bounds);
    }
  }, [bounds, map]);
  return null;
}

// Heatmap component that adds heat layer to the map
const HeatmapLayer = ({ heatmapData, showHeatmap }) => {
  const map = useMap();

  useEffect(() => {
    if (!showHeatmap || !heatmapData || heatmapData.length === 0) {
      // Remove existing heatmap
      map.eachLayer((layer) => {
        if (layer.options && layer.options.radius && layer.options.blur) {
          map.removeLayer(layer);
        }
      });
      return;
    }

    // Check if heatmap plugin is available
    if (!L.heatLayer) {
      console.error('Leaflet heatmap plugin not available');
      return;
    }

    // Convert data to heatmap format  
    const heatPoints = heatmapData.map(point => [
      point.lat, 
      point.lon, 
      point.intensity / 100 // Normalize intensity
    ]);

    // Create heatmap layer
    const heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      gradient: {
        0.0: 'blue',
        0.3: 'cyan', 
        0.5: 'lime',
        0.7: 'yellow',
        1.0: 'red'
      }
    });

    // Add to map
    heatLayer.addTo(map);

    // Cleanup function
    return () => {
      if (map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, heatmapData, showHeatmap]);

  return null;
};

const MapView = ({ selectedRoute, selectedDir, apiBase = process.env.REACT_APP_API_URL || "http://localhost:5000" }) => {
  const [patternCoords, setPatternCoords] = useState([]);
  const [allPatterns, setAllPatterns] = useState([]);
  const [stops, setStops] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [liveTracking, setLiveTracking] = useState(false);
  const [lastVehicleUpdate, setLastVehicleUpdate] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapData, setHeatmapData] = useState([]);

  // Fetch heatmap data
  const fetchHeatmapData = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/data/geospatial');
      const data = await response.json();
      setHeatmapData(data.heatmapPoints || []);
    } catch (error) {
      console.error('Failed to fetch heatmap data:', error);
      setHeatmapData([]);
    }
  };

  // Load heatmap data on component mount
  useEffect(() => {
    fetchHeatmapData();
  }, []);

  // Fetch patterns (route line)
  useEffect(() => {
    if (!selectedRoute || !selectedDir) {
      setPatternCoords([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    
    fetch(`${apiBase}/patterns?rt=${selectedRoute}&dir=${encodeURIComponent(selectedDir)}`)
      .then(res => res.json())
      .then(data => {
        console.log("Patterns API response:", data);
        
        // Check for API errors
        if (data.error) {
          setError(data.error);
          setPatternCoords([]);
          return;
        }

        // Handle the BusTime API response structure
        const bustimeResponse = data['bustime-response'];
        if (!bustimeResponse) {
          setError("No data in response");
          setPatternCoords([]);
          return;
        }

        // Get patterns array
        let patterns = bustimeResponse.ptr;
        if (!patterns) {
          setError("No patterns found for this route/direction");
          setPatternCoords([]);
          return;
        }

        // Ensure patterns is an array
        if (!Array.isArray(patterns)) {
          patterns = [patterns];
        }

        if (patterns.length === 0) {
          setError("No patterns found for this route/direction");
          setPatternCoords([]);
          return;
        }

        // Process each pattern separately
        const processedPatterns = patterns.map(pattern => {
          let points = pattern.pt;
          if (!points) return null;
          
          if (!Array.isArray(points)) {
            points = [points];
          }

          // Convert to coordinates array for this pattern
          const coords = points
            .map(pt => [parseFloat(pt.lat), parseFloat(pt.lon)])
            .filter(pair => 
              pair.every(num => typeof num === "number" && !isNaN(num))
            );
          
          return {
            coords,
            patternId: pattern.pid,
            direction: pattern.rtdir
          };
        }).filter(pattern => pattern && pattern.coords.length > 0);
        
        if (processedPatterns.length === 0) {
          setError("No valid patterns found");
          setPatternCoords([]);
          setAllPatterns([]);
          return;
        }

        console.log(`Found ${processedPatterns.length} valid patterns`);
        processedPatterns.forEach((pattern, index) => {
          console.log(`Pattern ${index + 1}: ${pattern.coords.length} points, direction: ${pattern.direction}`);
        });

        // For now, use the first pattern for the main route line
        // (we'll render all patterns separately in the JSX)
        setPatternCoords(processedPatterns[0].coords);
        setAllPatterns(processedPatterns);
        setError(null);
      })
      .catch(err => {
        console.error("Error fetching patterns:", err);
        setError("Failed to fetch route data");
        setPatternCoords([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedRoute, selectedDir, apiBase]);

  // Fetch stops (bus stop markers)
  useEffect(() => {
    if (!selectedRoute || !selectedDir) {
      setStops([]);
      return;
    }

    fetch(`${apiBase}/stops?rt=${selectedRoute}&dir=${encodeURIComponent(selectedDir)}`)
      .then(res => res.json())
      .then(data => {
        console.log("Stops API response:", data);
        
        if (data.error) {
          console.error("Error fetching stops:", data.error);
          setStops([]);
          return;
        }

        const bustimeResponse = data['bustime-response'];
        if (bustimeResponse && bustimeResponse.stops) {
          setStops(bustimeResponse.stops);
        } else {
          setStops([]);
        }
      })
      .catch(err => {
        console.error("Error fetching stops:", err);
        setStops([]);
      });
  }, [selectedRoute, selectedDir, apiBase]);

  // Live vehicle tracking with smart caching
  useEffect(() => {
    if (!liveTracking || !selectedRoute) {
      setVehicles([]);
      return;
    }

    const fetchVehicles = async () => {
      try {
        console.log("Fetching live vehicle data...");
        const response = await fetch(`${apiBase}/vehicles?rt=${selectedRoute}`);
        const data = await response.json();
        
        if (data.error) {
          console.error("Error fetching vehicles:", data.error);
          return;
        }

        const bustimeResponse = data['bustime-response'];
        if (bustimeResponse && bustimeResponse.vehicle) {
          let vehicleList = bustimeResponse.vehicle;
          if (!Array.isArray(vehicleList)) {
            vehicleList = [vehicleList];
          }
          
          // Filter vehicles by direction if we have that info
          const filteredVehicles = vehicleList.filter(vehicle => {
            // For now, show all vehicles on the route
            // Later we could filter by direction if the API provides that
            return true;
          });
          
          setVehicles(filteredVehicles);
          setLastVehicleUpdate(new Date());
          console.log(`Found ${filteredVehicles.length} live vehicles`);
        }
      } catch (err) {
        console.error("Error fetching vehicles:", err);
      }
    };

    // Fetch immediately
    fetchVehicles();
    
    // Set up interval for updates (every 30 seconds)
    const interval = setInterval(fetchVehicles, 30000);
    
    return () => clearInterval(interval);
  }, [liveTracking, selectedRoute, apiBase]);

  return (
    <div style={{ position: 'relative' }}>
      <style>
        {`
          .custom-bus-stop-icon {
            background: transparent !important;
            border: none !important;
          }
          .custom-live-bus-icon {
            background: transparent !important;
            border: none !important;
          }
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
          }
          .leaflet-popup-content-wrapper {
            border-radius: 8px;
            box-shadow: 0 3px 14px rgba(0,0,0,0.4);
          }
          .leaflet-popup-content {
            margin: 8px 12px;
            line-height: 1.4;
          }
        `}
      </style>
      
      {loading && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
          zIndex: 1000
        }}>
          Loading route...
        </div>
      )}
      
      {error && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: '#ffebee',
          color: '#c62828',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
          zIndex: 1000
        }}>
          Error: {error}
        </div>
      )}

      {/* Live Tracking Controls */}
      {selectedRoute && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
          zIndex: 1000
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={liveTracking}
              onChange={(e) => setLiveTracking(e.target.checked)}
            />
            Live Bus Tracking
          </label>
          {lastVehicleUpdate && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              Last update: {lastVehicleUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      <MapContainer center={DEFAULT_POS} zoom={13} style={{ height: '600px', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {allPatterns.length > 0 && (
          <>
            {allPatterns.map((pattern, index) => (
              <Polyline 
                key={pattern.patternId || index}
                positions={pattern.coords} 
                color="red" 
                weight={5}
                opacity={0.8}
              />
            ))}
          </>
        )}
        
        {/* Render bus stop markers */}
        {stops.map(stop => (
          <Marker 
            key={stop.stpid} 
            position={[parseFloat(stop.lat), parseFloat(stop.lon)]}
            icon={createBusStopIcon()}
          >
            <Popup>
              <div>
                <strong>{stop.stpnm}</strong>
                <br />
                Stop ID: {stop.stpid}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Render live bus markers */}
        {liveTracking && vehicles.map(vehicle => (
          <Marker 
            key={vehicle.vid} 
            position={[parseFloat(vehicle.lat), parseFloat(vehicle.lon)]}
            icon={createLiveBusIcon(vehicle.dly === 'true' || vehicle.dly === true)}
          >
            <Popup>
              <div>
                <strong>Bus #{vehicle.vid}</strong>
                <br />
                <strong>Route:</strong> {vehicle.rt}
                <br />
                <strong>Destination:</strong> {vehicle.des}
                <br />
                <strong>Status:</strong> {vehicle.dly === 'true' || vehicle.dly === true ? 'DELAYED' : 'On Time'}
                {vehicle.spd && <><br /><strong>Speed:</strong> {vehicle.spd} mph</>}
                {vehicle.psgld && <><br /><strong>Passenger Load:</strong> {formatPassengerLoad(vehicle.psgld)}</>}
                {vehicle.tmstmp && <><br /><strong>Last Update:</strong> {formatTimestamp(vehicle.tmstmp)}</>}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Heatmap Layer */}
        <HeatmapLayer heatmapData={heatmapData} showHeatmap={showHeatmap} />
      </MapContainer>

      {/* Heatmap Toggle Button */}
      <div style={{
        position: 'absolute',
        top: '80px',
        right: '10px',
        zIndex: 1000,
        background: 'white',
        padding: '10px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        border: '1px solid #ccc'
      }}>
        <button
          onClick={() => setShowHeatmap(!showHeatmap)}
          style={{
            background: showHeatmap ? '#ff4444' : '#2272b5',
            color: 'white',
            border: 'none',
            padding: '8px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
        >
          🔥 {showHeatmap ? 'Hide' : 'Show'} Heatmap
        </button>
        {showHeatmap && (
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            {heatmapData.length} GPS points
          </div>
        )}
      </div>
    </div>
  );
};

export default MapView;