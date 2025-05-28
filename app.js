// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const deviceIdInput = document.getElementById('deviceIdInput');
const statusDiv = document.getElementById('status');
const ecgValueDiv = document.getElementById('ecgValue');
const bpmValueDiv = document.getElementById('bpmValue');
const timestampDiv = document.getElementById('timestamp');

// Chart instances
let ecgChart = null;
let bpmChart = null;

// Data storage
const maxDataPoints = 200; // Number of points to show in the ECG chart
const maxBpmPoints = 60;   // Number of BPM readings to show (1 minute at 1 reading per second)
const ecgBufferSize = 200; // Buffer size for BPM calculation
let ecgData = [];          // Raw ECG values
let ecgTimestamps = [];     // Timestamps for ECG values
let bpmData = [];          // BPM values
let bpmLabels = [];        // Timestamps for BPM values
let ecgValues = [];        // Buffer for peak detection

// Peak detection variables
let lastPeakTime = 0;
let peakThreshold = 2500;  // Initial threshold for peak detection
let peakCount = 0;
let lastBpmCalculation = 0;
let lastBpmUpdate = 0;
const bpmUpdateInterval = 1000; // Update BPM calculation every second
let lastValidBpm = 0;

// Chart colors
const colors = {
  ecgLine: '#3498db',
  bpmLine: '#e74c3c',
  grid: 'rgba(0, 0, 0, 0.05)',
  text: '#666',
  background: '#fff'
};

// Setup BPM Chart
function setupBPMChart() {
  const bpmCtx = document.getElementById('bpmChart').getContext('2d');
  
  // Initialize with empty data
  bpmChart = new Chart(bpmCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Heart Rate',
        data: [],
        borderColor: '#e74c3c',
        borderWidth: 2,
        fill: false,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: '#e74c3c'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { 
          display: true,
          title: { 
            display: true, 
            text: 'Time (seconds ago)',
            color: '#666',
            font: { size: 12 }
          },
          grid: { display: false },
          ticks: {
            color: '#666',
            callback: function(value) {
              return maxBpmPoints - value;
            }
          }
        },
        y: { 
          min: 40, 
          max: 180,
          title: { 
            display: true, 
            text: 'BPM',
            color: '#666',
            font: { size: 12 }
          },
          grid: { 
            color: 'rgba(0, 0, 0, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: '#666',
            stepSize: 20
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          bodyFont: { size: 14, weight: 'bold' },
          callbacks: {
            label: function(context) {
              return ` ${context.parsed.y.toFixed(0)} BPM`;
            },
            labelTextColor: function() {
              return '#fff';
            }
          }
        }
      }
    }
  });
}

// Detect peaks in ECG data for BPM calculation
function detectPeak(value, timestamp) {
  // Simple peak detection with dynamic threshold
  if (value > peakThreshold) {
    const timeSinceLastPeak = timestamp - lastPeakTime;
    
    // Ensure minimum time between peaks (300ms = ~200 BPM max)
    if (timeSinceLastPeak > 300) {
      lastPeakTime = timestamp;
      peakCount++;
      
      // Store peak data for BPM calculation
      if (ecgValues.length >= ecgBufferSize) {
        ecgValues.shift();
      }
      ecgValues.push({ value, timestamp });
      
      // Adjust threshold (85% of peak value, with limits)
      peakThreshold = Math.min(Math.max(value * 0.85, 1000), 3500);
      return true;
    }
  } else {
    // Gradually decrease threshold if no peaks detected
    peakThreshold = Math.max(peakThreshold * 0.995, 1000);
  }
  return false;
}

// Calculate BPM from peak intervals
function calculateBPM() {
  const now = Date.now();
  if (now - lastBpmCalculation < bpmUpdateInterval) return;
  
  lastBpmCalculation = now;
  
  // Calculate BPM based on peaks in the last 10 seconds
  const timeWindow = 10000; // 10 seconds
  const recentPeaks = ecgValues
    .filter(item => new Date(item.timestamp).getTime() > now - timeWindow)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Calculate BPM based on average interval between peaks
  let bpm = 0;
  if (recentPeaks.length > 1) {
    const intervals = [];
    for (let i = 1; i < recentPeaks.length; i++) {
      const timeDiff = new Date(recentPeaks[i].timestamp).getTime() - 
                      new Date(recentPeaks[i-1].timestamp).getTime();
      // Only include reasonable intervals (corresponding to 40-180 BPM)
      if (timeDiff > 333 && timeDiff < 1500) {
        intervals.push(timeDiff);
      }
    }
    
    if (intervals.length > 0) {
      // Use median instead of average to be more robust to outliers
      const sortedIntervals = [...intervals].sort((a, b) => a - b);
      const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
      bpm = Math.round(60000 / medianInterval);
      // Ensure BPM is within reasonable limits
      bpm = Math.max(40, Math.min(180, bpm));
    }
  }
  
  // Only update if we have a valid BPM or it's been a while since last update
  const shouldUpdate = bpm > 0 || bpmData.length === 0 || (now - lastBpmUpdate > 5000);
  
  if (shouldUpdate) {
    lastBpmUpdate = now;
    
    // Update BPM data array
    if (bpmData.length >= maxBpmPoints) {
      bpmData.shift();
      bpmLabels.shift();
    }
    
    // If no valid BPM, use the last valid one or 0
    const displayBpm = bpm > 0 ? bpm : (bpmData[bpmData.length - 1] || 0);
    
    bpmData.push(displayBpm);
    bpmLabels.push(new Date(now).toLocaleTimeString().split(':').slice(1).join(':'));
    
    // Update BPM display
    bpmValueDiv.textContent = displayBpm > 0 ? displayBpm : '--';
    
    // Update BPM chart
    if (bpmChart) {
      // Only update if we have new data
      if (bpmData.length > 1) {
        // Update chart data
        bpmChart.data.labels = [...bpmLabels];
        bpmChart.data.datasets[0].data = [...bpmData];
        
        // Update with minimal animation
        bpmChart.update({
          duration: 0, // No animation
          lazy: true,
          skipTransitions: true
        });
      }
    }
  }
  
  return bpm > 0 ? bpm : null;
}

// Process incoming ECG data
function processECGData(timestamp, ecgValue) {
  try {
    const now = new Date();
    const currentTime = now.getTime();
    
    // Update timestamp display
    timestampDiv.textContent = now.toLocaleTimeString();
    
    // Only process valid ECG values
    if (typeof ecgValue === 'number' && !isNaN(ecgValue)) {
      const roundedValue = Math.round(ecgValue);
      
      // Update ECG value display
      ecgValueDiv.textContent = roundedValue;
      
      // Add to ECG data array
      if (ecgData.length >= maxDataPoints) {
        ecgData.shift();
        ecgTimestamps.shift();
      }
      
      ecgData.push(roundedValue);
      ecgTimestamps.push(currentTime);
      
      // Update ECG chart
      if (ecgChart) {
        ecgChart.data.labels = ecgTimestamps.map(t => new Date(t).toLocaleTimeString());
        ecgChart.data.datasets[0].data = ecgData;
        ecgChart.update('none');
      }
      
      // Process for BPM calculation
      detectPeak(roundedValue, currentTime);
      calculateBPM();
    }
  } catch (e) {
    console.error('Error processing ECG data:', e);
  }
}

// Connect to HiveMQ Cloud MQTT broker over WebSocket TLS
function connectMQTT(deviceId) {
  const options = {
    keepalive: 30,
    clientId: 'webclient_' + Math.random().toString(16).substr(2, 8),
    username: 'maharshi',
    password: 'Maharshi24',
    protocol: 'wss',
    reconnectPeriod: 1000,
    clean: true,
    rejectUnauthorized: false
  };

  const brokerUrl = 'wss://2a086fbdeb91453eacd25659758b74f3.s1.eu.hivemq.cloud:8884/mqtt';

  client = mqtt.connect(brokerUrl, options);

  client.on('connect', () => {
    const ecgTopic = `iot/devices/${deviceId}`;
    const statusTopic = `iot/devices/${deviceId}/status`;

    statusDiv.textContent = `Connected to MQTT broker. Subscribing to ${ecgTopic}...`;

    client.subscribe(ecgTopic, (err) => {
      if (err) {
        statusDiv.textContent = 'ECG Subscription error: ' + err.message;
      } else {
        statusDiv.textContent = `Subscribed to ${ecgTopic}. Waiting for data...`;
        console.log(`Subscribed to ${ecgTopic}`);
      }
    });

    client.subscribe(statusTopic, (err) => {
      if (err) {
        console.error('Status topic subscription error:', err.message);
      } else {
        console.log(`Subscribed to ${statusTopic}`);
      }
    });
  });

  client.on('error', (err) => {
    const errorMsg = `Connection error: ${err.message}`;
    console.error(errorMsg);
    statusDiv.textContent = errorMsg;
    client.end();
  });

  client.on('message', (topic, message) => {
    try {
      console.log(`Message received on ${topic}:`, message.toString());
      
      if (topic.endsWith('/status')) {
        const statusMsg = message.toString();
        console.log('Status update:', statusMsg);
        statusDiv.textContent = `Device status: ${statusMsg}`;
        return;
      }

      const data = JSON.parse(message.toString());
      const ecgValue = parseInt(data.ecg_value);
      const timestamp = data.timestamp || new Date().toISOString();
      
      if (isNaN(ecgValue)) {
        console.error('Invalid ECG value received:', data.ecg_value);
        return;
      }
      
      // Process the ECG data for BPM calculation and display
      processECGData(timestamp, ecgValue);
      
    } catch (e) {
      console.error('Error processing message:', e);
      console.error('Raw message:', message ? message.toString() : 'No message');
    }
  });

  client.on('close', () => {
    console.log('Disconnected from MQTT broker');
    statusDiv.textContent = 'Disconnected from MQTT broker';
  });

  client.on('offline', () => {
    console.log('MQTT client is offline');
    statusDiv.textContent = 'Connection lost. Attempting to reconnect...';
  });

  client.on('reconnect', () => {
    console.log('Attempting to reconnect to MQTT broker...');
    statusDiv.textContent = 'Reconnecting to MQTT broker...';
  });
}

connectBtn.addEventListener('click', () => {
  const deviceId = deviceIdInput.value.trim();
  if (!deviceId) {
    alert('Please enter a device ID');
    return;
  }

  if (client) {
    client.end();
  }
  // Reset data arrays
  ecgValues = [];
  bpmData = [];
  bpmLabels = [];
  lastPeakTime = 0;
  peakCount = 0;
  
  // Reset chart
  if (bpmChart) {
    bpmChart.destroy();
  }
  setupBPMChart();
  
  // Reset BPM display
  bpmValueDiv.textContent = '--';
  timestampDiv.textContent = 'Waiting for data...';
  statusDiv.textContent = 'Connecting...';
  connectMQTT(deviceId);
});

// Initialize ECG Chart
function initECGChart() {
  const ecgCtx = document.getElementById('ecgChart').getContext('2d');
  return new Chart(ecgCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'ECG Signal',
        data: [],
        borderColor: colors.ecgLine,
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          display: false
        },
        y: {
          min: 0,
          max: 4095,
          grid: {
            color: colors.grid
          },
          ticks: {
            color: colors.text,
            stepSize: 1000
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              return `ECG: ${context.parsed.y}`;
            }
          }
        }
      }
    }
  });
}

// Initialize BPM Chart
function initBPMChart() {
  const bpmCtx = document.getElementById('bpmChart').getContext('2d');
  return new Chart(bpmCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Heart Rate',
        data: [],
        borderColor: colors.bpmLine,
        borderWidth: 2,
        fill: false,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          grid: {
            color: colors.grid
          },
          ticks: {
            color: colors.text
          }
        },
        y: {
          min: 40,
          max: 180,
          grid: {
            color: colors.grid
          },
          ticks: {
            color: colors.text,
            stepSize: 20
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `BPM: ${context.parsed.y}`;
            }
          }
        }
      }
    }
  });
}

// Initialize charts when the page loads
window.addEventListener('load', () => {
  // Initialize charts
  ecgChart = initECGChart();
  bpmChart = initBPMChart();
  
  // Set up connection button handler
  connectBtn.addEventListener('click', () => {
    const deviceId = deviceIdInput.value.trim();
    if (!deviceId) {
      alert('Please enter a device ID');
      return;
    }
    
    // Reset data
    ecgData = [];
    ecgTimestamps = [];
    bpmData = [];
    bpmLabels = [];
    lastPeakTime = 0;
    peakCount = 0;
    peakThreshold = 2500;
    
    // Update UI
    ecgValueDiv.textContent = '--';
    bpmValueDiv.textContent = '--';
    timestampDiv.textContent = '--:--:--';
    statusDiv.textContent = 'Connecting...';
    
    // Connect to MQTT
    connectMQTT(deviceId);
  });
  
  // Set default device ID if needed
  deviceIdInput.value = 'ECG1';
});
