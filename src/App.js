import React, { useState, useEffect } from 'react';
import './App.css';
import { database } from './firebaseConfig';
import { ref, onValue, update } from 'firebase/database';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function App() {
  const [liveData, setLiveData] = useState({
    I: 0,
    V: 0,
    W: 0,
    P: 0,
    Relay: 0,
    Choke: "0",
    ts: 0,
    dc_current: 0,
    dc_voltage: 0,
    frequency: 50 // Default frequency in Hz
  });
  const [historyData, setHistoryData] = useState([]);
  const [sineWaveData, setSineWaveData] = useState({
    current: [],
    voltage: [],
    power: [],
    labels: []
  });
  
  const [dcData, setDcData] = useState({
    dc_current: [],
    dc_voltage: [],
    labels: []
  });
  
  // New state for advanced features
  const [harmonicData, setHarmonicData] = useState({
    harmonics: [
      { order: 1, amplitude: 0.95, phase: 0, thd: 1.2 },
      { order: 3, amplitude: 0.15, phase: 45, thd: 2.1 },
      { order: 5, amplitude: 0.08, phase: 90, thd: 3.5 },
      { order: 7, amplitude: 0.05, phase: 135, thd: 1.8 },
      { order: 9, amplitude: 0.03, phase: 180, thd: 0.9 },
    ],
    totalTHD: 2.5 // Initialize with calculated THD percentage
  });
  
  // State to track data updates
  const [lastDataUpdate, setLastDataUpdate] = useState(Date.now());
  const [isDataUpdating, setIsDataUpdating] = useState(true);
  const [previousData, setPreviousData] = useState(null);
  
  const [mlPredictions, setMlPredictions] = useState({
    compensationLevel: 85.7,
    responseDelay: 12.3,
    nextAnomaly: '2025-10-31 16:45:00',
    confidence: 92.1
  });
  
  const [thdHistory, setThdHistory] = useState([
    // Initialize with some sample historical data (THD percentage values)
    { time: '14:45:10', thd: 2.2, anomaly: false, isLive: false, timestamp: Date.now() - 900000 },
    { time: '14:46:15', thd: 3.1, anomaly: false, isLive: false, timestamp: Date.now() - 840000 },
    { time: '14:47:20', thd: 1.8, anomaly: false, isLive: false, timestamp: Date.now() - 780000 },
    { time: '14:48:25', thd: 4.2, anomaly: false, isLive: false, timestamp: Date.now() - 720000 },
    { time: '14:49:30', thd: 5.8, anomaly: true, isLive: false, timestamp: Date.now() - 660000 },
    { time: '14:50:35', thd: 3.5, anomaly: false, isLive: false, timestamp: Date.now() - 600000 },
    { time: '14:51:40', thd: 2.7, anomaly: false, isLive: false, timestamp: Date.now() - 540000 },
    { time: '14:52:45', thd: 3.9, anomaly: false, isLive: false, timestamp: Date.now() - 480000 },
    { time: '14:53:50', thd: 4.5, anomaly: false, isLive: false, timestamp: Date.now() - 420000 },
    { time: '14:54:55', thd: 6.2, anomaly: true, isLive: false, timestamp: Date.now() - 360000 },
  ]);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    // Listen for live data changes
    const liveDataRef = ref(database, '2_AC_Power_Facter/1_AC_Power_Choke');
    const unsubscribeLive = onValue(liveDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Apply control logic
        let updatedI = data.I || 0;
        let updatedRelay = data.Relay || 0;
        const voltage = data.V || 0;
        const choke = data.Choke || "0";
        let needsUpdate = false;
        const updates = {};
        
        // If voltage > 200, set current to 1.5A
        if (voltage > 200 && updatedI !== 1.5) {
          updatedI = 1.5;
          updates.I = 1.5;
          needsUpdate = true;
        }
        
        // If choke is 1, relay should be 1; if choke is 0, relay should be 0
        const chokeValue = (choke === "1" || choke === 1) ? 1 : 0;
        if (updatedRelay !== chokeValue) {
          updatedRelay = chokeValue;
          updates.Relay = chokeValue;
          needsUpdate = true;
        }
        
        // Update Firebase if needed
        if (needsUpdate) {
          update(liveDataRef, updates).catch(error => {
            console.error("Error updating Firebase:", error);
          });
        }
        
        // Calculate frequency (50Hz base with slight variation)
        const frequency = 50 + (Math.random() - 0.5) * 0.2;
        
        // Map Firebase fields directly
        const mappedData = {
          I: updatedI,
          V: voltage,
          W: data.W || 0,
          P: data.P || 0,
          Relay: updatedRelay,
          Choke: choke,
          ts: Date.now(),
          dc_current: 0,
          dc_voltage: 0,
          frequency: frequency
        };
        
        // Check if data has actually changed
        const hasDataChanged = !previousData || 
          previousData.I !== mappedData.I ||
          previousData.V !== mappedData.V ||
          previousData.W !== mappedData.W ||
          previousData.P !== mappedData.P ||
          previousData.Relay !== mappedData.Relay ||
          previousData.Choke !== mappedData.Choke;
        
        if (hasDataChanged) {
          setIsDataUpdating(true);
          setLastDataUpdate(Date.now());
          setPreviousData(mappedData);
          
          setLiveData(prev => ({...prev, ...mappedData}));
          updateSineWaveData(mappedData);
          updateHarmonicData(mappedData);
          updateMlPredictions(mappedData);
          checkAlerts(mappedData);
        } else {
          // Data not changing, just update timestamp but don't trigger analysis
          setLiveData(prev => ({...prev, ts: Date.now()}));
        }
      }
    });
    
    // Listen for DC values at root level
    const dcDataRef = ref(database, '2_AC_Power_Facter');
    const unsubscribeDc = onValue(dcDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const dcValues = {
          dc_current: data.DC_Current || 0,
          dc_voltage: data.DC_Voltage || 0
        };
        setLiveData(prev => ({...prev, ...dcValues}));
        updateDcData({...liveData, ...dcValues});
      }
    });

    // Listen for history data changes
    const historyRef = ref(database, '2_AC_Power_Facter/history');
    const unsubscribeHistory = onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const historyArray = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 5);
        setHistoryData(historyArray);
      }
    });

    // Monitor for data update activity
    const updateCheckInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastDataUpdate;
      // If no update in last 5 seconds, consider data as stopped
      if (timeSinceLastUpdate > 5000) {
        setIsDataUpdating(false);
      }
    }, 1000);
    
    // Simulate real-time harmonic updates every 2 seconds - only if data is updating
    const harmonicInterval = setInterval(() => {
      if (isDataUpdating) {
        simulateHarmonicChanges();
      }
    }, 2000);

    return () => {
      unsubscribeLive();
      unsubscribeDc();
      unsubscribeHistory();
      clearInterval(harmonicInterval);
      clearInterval(updateCheckInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDataUpdate, isDataUpdating]);

  const updateSineWaveData = (data) => {
    const time = new Date().toLocaleTimeString();
    
    setSineWaveData(prev => {
      const maxPoints = 20;
      const newLabels = [...prev.labels, time].slice(-maxPoints);
      const newCurrent = [...prev.current, data.I].slice(-maxPoints);
      const newVoltage = [...prev.voltage, data.V].slice(-maxPoints);
      const newPower = [...prev.power, data.W].slice(-maxPoints);
      
      return {
        labels: newLabels,
        current: newCurrent,
        voltage: newVoltage,
        power: newPower
      };
    });
  };
  
  const updateDcData = (data) => {
    const time = new Date().toLocaleTimeString();
    
    setDcData(prev => {
      const maxPoints = 20;
      const newLabels = [...prev.labels, time].slice(-maxPoints);
      const newDcCurrent = [...prev.dc_current, data.dc_current].slice(-maxPoints);
      const newDcVoltage = [...prev.dc_voltage, data.dc_voltage].slice(-maxPoints);
      
      return {
        labels: newLabels,
        dc_current: newDcCurrent,
        dc_voltage: newDcVoltage
      };
    });
  };

  const updateHarmonicData = (data) => {
    // Only update if data is actively changing
    if (!isDataUpdating) {
      return; // Keep last harmonic data
    }
    
    // Simulate harmonic analysis based on live data
    const baseAmplitude = data.I || 0.5;
    const choke = data.Choke || "0";
    
    // THD control based on choke status
    let totalTHD;
    if (choke === "0" || choke === 0) {
      // Choke OFF: THD can vary more widely
      // Below 4.5 (excellent), 4.5-5 (good), or above 5 (high)
      const rand = Math.random();
      if (rand < 0.3) {
        // 30% chance: below 4.5 (excellent)
        totalTHD = Math.random() * 0.5 + 4.0; // 4.0-4.5
      } else if (rand < 0.7) {
        // 40% chance: 4.5-5 (good)
        totalTHD = Math.random() * 0.5 + 4.5; // 4.5-5.0
      } else {
        // 30% chance: above 5 (high)
        totalTHD = Math.random() * 0.5 + 5.0; // 5.0-5.5
      }
    } else {
      // Choke ON: THD should stay between 4.5-5 (optimal range)
      totalTHD = Math.random() * 0.5 + 4.5; // 4.5-5.0
    }
    
    const newHarmonics = harmonicData.harmonics.map(harmonic => ({
      ...harmonic,
      amplitude: baseAmplitude * (Math.random() * 0.3 + 0.1) / harmonic.order,
      thd: totalTHD / harmonicData.harmonics.length + (Math.random() - 0.5) * 0.2
    }));
    
    setHarmonicData({
      harmonics: newHarmonics,
      totalTHD
    });
    
    // Update THD history with the calculated value
    updateThdHistoryWithValue(totalTHD);
  };

  const updateMlPredictions = (data) => {
    // Simulate ML predictions based on current data
    setMlPredictions(prev => ({
      compensationLevel: 80 + Math.random() * 20,
      responseDelay: 10 + Math.random() * 10,
      nextAnomaly: new Date(Date.now() + Math.random() * 3600000).toLocaleString(),
      confidence: 85 + Math.random() * 15
    }));
  };

  const updateThdHistoryWithValue = (currentTHD) => {
    // Only add new THD history entries when data is actively updating
    if (!isDataUpdating) {
      return; // Keep last THD data
    }
    
    const time = new Date().toLocaleTimeString();
    
    setThdHistory(prev => {
      const maxPoints = 50; // Increased to show more historical data
      const newEntry = { 
        time, 
        thd: currentTHD, 
        anomaly: currentTHD > 5, // Anomaly if THD is greater than 5%
        isLive: true,
        timestamp: Date.now()
      };
      
      // Mark previous entries as not live
      const updatedHistory = prev.map(entry => ({ ...entry, isLive: false }));
      
      return [...updatedHistory, newEntry].slice(-maxPoints);
    });
  };

  const checkAlerts = (data) => {
    const newAlerts = [];
    const currentTime = new Date().toLocaleString();
    
    // Check for overload
    if (data.power_w > 0.005) {
      newAlerts.push({
        id: Date.now() + 1,
        type: 'overload',
        message: 'Power overload detected',
        severity: 'high',
        timestamp: currentTime
      });
    }
    
    // Check for unbalanced load
    if (Math.abs(data.current_a - data.voltage_v) > 0.1) {
      newAlerts.push({
        id: Date.now() + 2,
        type: 'unbalanced',
        message: 'Unbalanced load detected',
        severity: 'medium',
        timestamp: currentTime
      });
    }
    
    // Check for low Power Factor
    if (harmonicData.totalTHD > 5) {
      newAlerts.push({
        id: Date.now() + 3,
        type: 'thd',
        message: `High THD detected: ${harmonicData.totalTHD.toFixed(2)}%`,
        severity: 'high',
        timestamp: currentTime
      });
    }
    
    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 10));
    }
  };

  const simulateHarmonicChanges = () => {
    // Only simulate changes if data is actively updating
    if (!isDataUpdating) {
      return; // Keep last harmonic data
    }
    
    const choke = liveData.Choke || "0";
    
    // Generate THD based on choke status
    let newTotalTHD;
    if (choke === "0" || choke === 0) {
      // Choke OFF: THD varies across ranges
      const rand = Math.random();
      if (rand < 0.3) {
        newTotalTHD = Math.random() * 0.5 + 4.0; // Below 4.5
      } else if (rand < 0.7) {
        newTotalTHD = Math.random() * 0.5 + 4.5; // 4.5-5.0
      } else {
        newTotalTHD = Math.random() * 0.5 + 5.0; // Above 5.0
      }
    } else {
      // Choke ON: Keep THD between 4.5-5 (optimal)
      newTotalTHD = Math.random() * 0.5 + 4.5;
    }
    
    setHarmonicData(prev => ({
      ...prev,
      totalTHD: newTotalTHD,
      harmonics: prev.harmonics.map(harmonic => ({
        ...harmonic,
        amplitude: harmonic.amplitude * (0.9 + Math.random() * 0.2),
        thd: newTotalTHD / prev.harmonics.length + (Math.random() - 0.5) * 0.2
      }))
    }));
    
    // Update THD history
    updateThdHistoryWithValue(newTotalTHD);
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
    animation: {
      duration: 300,
    },
  };

  const currentChartData = {
    labels: sineWaveData.labels,
    datasets: [
      {
        label: 'Current (I)',
        data: sineWaveData.current,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        tension: 0.4,
      },
    ],
  };

  const voltageChartData = {
    labels: sineWaveData.labels,
    datasets: [
      {
        label: 'Voltage (V)',
        data: sineWaveData.voltage,
        borderColor: 'rgb(53, 162, 235)',
        backgroundColor: 'rgba(53, 162, 235, 0.2)',
        tension: 0.4,
      },
    ],
  };

  const powerChartData = {
    labels: sineWaveData.labels,
    datasets: [
      {
        label: 'Power (W)',
        data: sineWaveData.power,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.4,
      },
    ],
  };
  
  const dcCurrentChartData = {
    labels: dcData.labels,
    datasets: [
      {
        label: 'DC Current (A)',
        data: dcData.dc_current,
        borderColor: 'rgb(255, 159, 64)',
        backgroundColor: 'rgba(255, 159, 64, 0.2)',
        tension: 0.4,
      },
    ],
  };
  
  const dcVoltageChartData = {
    labels: dcData.labels,
    datasets: [
      {
        label: 'DC Voltage (V)',
        data: dcData.dc_voltage,
        borderColor: 'rgb(153, 102, 255)',
        backgroundColor: 'rgba(153, 102, 255, 0.2)',
        tension: 0.4,
      },
    ],
  };

  // Harmonic Analysis Chart Data
  const harmonicChartData = {
    labels: harmonicData.harmonics.map(h => `${h.order}th`),
    datasets: [
      {
        label: 'Amplitude',
        data: harmonicData.harmonics.map(h => h.amplitude),
        backgroundColor: harmonicData.harmonics.map(h => 
          h.thd < 2 ? 'rgba(46, 204, 113, 0.8)' : 
          h.thd > 4 ? 'rgba(231, 76, 60, 0.8)' : 
          'rgba(241, 196, 15, 0.8)'
        ),
        borderColor: harmonicData.harmonics.map(h => 
          h.thd < 2 ? 'rgb(46, 204, 113)' : 
          h.thd > 4 ? 'rgb(231, 76, 60)' : 
          'rgb(241, 196, 15)'
        ),
        borderWidth: 2,
      },
    ],
  };

  // THD History Chart Data
  const thdHistoryChartData = {
    labels: thdHistory.map(item => item.time),
    datasets: [
      {
        label: 'THD (%)',
        data: thdHistory.map(item => item.thd),
        borderColor: 'rgb(155, 89, 182)',
        backgroundColor: 'rgba(155, 89, 182, 0.2)',
        pointBackgroundColor: thdHistory.map(item => {
          if (item.isLive) return 'rgb(46, 204, 113)'; // Green for live data
          if (item.anomaly) return 'rgb(231, 76, 60)'; // Red for anomalies
          return 'rgb(155, 89, 182)'; // Purple for normal historical data
        }),
        pointBorderColor: thdHistory.map(item => {
          if (item.isLive) return 'rgb(39, 174, 96)';
          if (item.anomaly) return 'rgb(192, 57, 43)';
          return 'rgb(142, 68, 173)';
        }),
        pointRadius: thdHistory.map(item => {
          if (item.isLive) return 8; // Larger for live data
          if (item.anomaly) return 6; // Medium for anomalies
          return 3; // Small for normal data
        }),
        pointBorderWidth: thdHistory.map(item => item.isLive ? 3 : 2),
        tension: 0.4,
      },
      {
        label: 'THD Threshold (5%)',
        data: Array(thdHistory.length).fill(5),
        borderColor: 'rgb(231, 76, 60)',
        borderDash: [5, 5],
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const getBestHarmonic = () => {
    const currentTHD = harmonicData.totalTHD;
    const choke = liveData.Choke;
    
    // Find harmonic with lowest THD
    const bestHarmonic = harmonicData.harmonics.reduce((best, current) => 
      current.thd < best.thd ? current : best
    );
    
    // Determine status based on THD and choke
    let status = 'Normal';
    let noiseLevel = 'Low Noise';
    
    if (choke === "0" || choke === 0) {
      // Choke OFF
      if (currentTHD < 4.5) {
        status = 'Excellent';
        noiseLevel = 'Very Low Noise';
      } else if (currentTHD >= 4.5 && currentTHD <= 5) {
        status = 'Good';
        noiseLevel = 'Low Noise';
      } else if (currentTHD > 5) {
        status = 'High';
        noiseLevel = 'High Noise';
      }
    } else if (choke === "1" || choke === 1) {
      // Choke ON
      if (currentTHD >= 4.5 && currentTHD <= 5) {
        status = 'Optimal';
        noiseLevel = 'Controlled';
      } else if (currentTHD < 4.5) {
        status = 'Below Target';
        noiseLevel = 'Too Low';
      } else if (currentTHD > 5) {
        status = 'Above Target';
        noiseLevel = 'High Noise';
      }
    }
    
    return {
      ...bestHarmonic,
      status,
      noiseLevel
    };
  };

  const dismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>Neural Power Monitoring System</h1>
        <div className="status-indicator">
          <span className={`status-dot ${liveData.distribution_on ? 'online' : 'offline'}`}></span>
          <span className="status-text">
            {liveData.distribution_on ? 'Distribution ON' : 'Distribution OFF'}
          </span>
          <div className="thd-indicator">
            <span className={`thd-badge ${harmonicData.totalTHD > 5 ? 'high' : 'normal'}`}>
              THD: {harmonicData.totalTHD.toFixed(2)}%
            </span>
            <span className={`update-status ${isDataUpdating ? 'updating' : 'stopped'}`}>
              {isDataUpdating ? '🔄 Updating' : '⏸️ Stopped (Last Data)'}
            </span>
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* Live Data Cards Section */}
        <section className="live-data-section">
          <h2>Live Data</h2>
          <div className="data-cards">
            <div className="data-card choke">
              <div className="card-icon">🔌</div>
              <div className="card-content">
                <h3>Choke</h3>
                <div className="card-value">{liveData.Choke || "0"}</div>
                <div className="card-unit">Status</div>
              </div>
            </div>
            
            <div className="data-card current">
              <div className="card-icon">⚡</div>
              <div className="card-content">
                <h3>Current (I)</h3>
                <div className="card-value">{(liveData.I || 0).toFixed(5)}</div>
                <div className="card-unit">Amperes</div>
              </div>
            </div>
            
            <div className="data-card power-factor">
              <div className="card-icon">📊</div>
              <div className="card-content">
                <h3>Power Factor (P)</h3>
                <div className="card-value">{(liveData.P || 0).toFixed(0)}</div>
                <div className="card-unit">PF</div>
              </div>
            </div>
            
            <div className="data-card relay">
              <div className="card-icon">💡</div>
              <div className="card-content">
                <h3>Relay</h3>
                <div className="card-value">
                  <span className={`status-badge ${liveData.Relay ? 'on' : 'off'}`}>
                    {liveData.Relay ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="card-unit">Status</div>
              </div>
            </div>
            
            <div className="data-card voltage">
              <div className="card-icon">🔋</div>
              <div className="card-content">
                <h3>Voltage (V)</h3>
                <div className="card-value">{(liveData.V || 0).toFixed(5)}</div>
                <div className="card-unit">Volts</div>
              </div>
            </div>
            
            <div className="data-card power">
              <div className="card-icon">⚙️</div>
              <div className="card-content">
                <h3>Power (W)</h3>
                <div className="card-value">{(liveData.W || 0).toFixed(5)}</div>
                <div className="card-unit">Watts</div>
              </div>
            </div>
            
            <div className="data-card frequency">
              <div className="card-icon">📡</div>
              <div className="card-content">
                <h3>Frequency</h3>
                <div className="card-value">{(liveData.frequency || 50).toFixed(2)}</div>
                <div className="card-unit">Hz</div>
              </div>
            </div>
          </div>
        </section>

        {/* Harmonic Analysis Panel */}
        <section className="harmonic-section">
          <h2>Harmonic Analysis</h2>
          <div className="harmonic-panel">
            <div className="harmonic-overview">
              <div className="harmonic-card">
                <h3>Total THD</h3>
                <div className={`thd-value ${harmonicData.totalTHD > 5 ? 'high' : 'normal'}`}>
                  {(harmonicData.totalTHD || 0).toFixed(2)}%
                </div>
              </div>
              <div className="harmonic-card">
                <h3>Best Harmonic</h3>
                <div className="best-harmonic">
                  <span className="harmonic-order">{getBestHarmonic().order}th</span>
                  <span className={`noise-indicator ${getBestHarmonic().status === 'High' || getBestHarmonic().status === 'Above Target' ? 'red' : getBestHarmonic().status === 'Optimal' || getBestHarmonic().status === 'Excellent' ? 'green' : 'yellow'}`}>
                    {getBestHarmonic().noiseLevel}
                  </span>
                </div>
                <div className="harmonic-status">
                  <small>Status: {getBestHarmonic().status}</small>
                </div>
              </div>
            </div>
            <div className="harmonic-chart">
              <h3>Harmonic Spectrum</h3>
              <Bar data={harmonicChartData} options={chartOptions} />
            </div>
          </div>
        </section>

        {/* THD Historical Trends */}
        <section className="thd-history-section">
          <h2>THD Historical Trends</h2>
          <div className="thd-chart-container compact">
            <div className="thd-legend">
              <div className="legend-item">
                <span className="legend-dot live"></span>
                <span>Live Data</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot anomaly"></span>
                <span>Anomaly (&gt;5%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot normal"></span>
                <span>Historical</span>
              </div>
            </div>
            <Line data={thdHistoryChartData} options={{
              ...chartOptions,
              maintainAspectRatio: false,
              plugins: {
                ...chartOptions.plugins,
                title: {
                  display: true,
                  text: 'THD Trends with Real-time Monitoring & Anomaly Detection',
                  font: {
                    size: 14,
                    weight: 'bold'
                  }
                },
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    boxWidth: 12,
                    padding: 15
                  }
                }
              },
              scales: {
                ...chartOptions.scales,
                x: {
                  display: true,
                  title: {
                    display: true,
                    text: 'Time'
                  },
                  ticks: {
                    maxTicksLimit: 10
                  }
                },
                y: {
                  beginAtZero: true,
                  max: 10,
                  title: {
                    display: true,
                    text: 'THD (%)'
                  }
                }
              }
            }} height={200} />
          </div>
        </section>

        {/* Real-time Charts Section */}
        <section className="charts-section">
          <h2>Real-time Monitoring</h2>
          <div className="charts-grid">
            <div className="chart-container">
              <h3>Current (I) Trend</h3>
              <Line data={currentChartData} options={chartOptions} />
            </div>
            
            <div className="chart-container">
              <h3>Voltage (V) Trend</h3>
              <Line data={voltageChartData} options={chartOptions} />
            </div>
            
            <div className="chart-container">
              <h3>Power (W) Trend</h3>
              <Line data={powerChartData} options={chartOptions} />
            </div>
          </div>
        </section>

        {/* History Section */}
        {/* <section className="history-section">
          <h2>Recent History (Last 5 Records)</h2>
          <div className="history-table">
            <div className="table-header">
              <div>Timestamp</div>
              <div>Current (A)</div>
              <div>Voltage (V)</div>
              <div>Power (W)</div>
              <div>Distribution</div>
            </div>
            {historyData.map((record, index) => (
              <div key={record.id} className="table-row">
                <div>{formatTimestamp(record.ts)}</div>
                <div>{record.current_a?.toFixed(4) || 'N/A'}</div>
                <div>{record.voltage_v?.toFixed(4) || 'N/A'}</div>
                <div>{record.power_w?.toFixed(4) || 'N/A'}</div>
                <div>
                  <span className={`status-badge ${record.distribution_on ? 'on' : 'off'}`}>
                    {record.distribution_on ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section> */}
      </main>

      <footer className="app-footer">
        <p>Neural Power Monitoring © 2025 | Last Update: {formatTimestamp(liveData.ts)}</p>
      </footer>
    </div>
  );
}

export default App;
