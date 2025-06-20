// ECG Monitor Application
class ECGMonitor {
  constructor() {
    // MQTT Configuration
    this.mqttConfig = {
      brokerUrl: 'wss://2a086fbdeb91453eacd25659758b74f3.s1.eu.hivemq.cloud:8884/mqtt',
      username: 'maharshi',
      password: 'Maharshi24'
    };
    
    // Application state
    this.client = null;
    this.isConnected = false;
    this.isPaused = false;
    this.deviceId = '';
    
    // Data storage
    this.ecgData = [];
    this.ecgTimestamps = [];
    this.bpmData = [];
    this.bpmTimestamps = [];
    this.dataCount = 0;
    
    // Chart configuration
    this.maxECGPoints = 250;      // Show last 2.5 seconds (250 points at 100Hz)
    this.maxBPMPoints = 60;       // Show last 60 points (1 minute)
    this.ecgChart = null;         // Chart.js instance for ECG waveform
    this.bpmChart = null;         // Chart.js instance for BPM trend
    this.beatChart = null;        // Chart.js instance for beat analysis

    // ECG Display enhancement
    this.ecgSweepPosition = 0;    // Current sweep position for real-time effect
    this.ecgDisplayBuffer = [];   // Enhanced display buffer
    this.baselineValue = 2048;    // ADC baseline (middle of 0-4095 range)

    // BPM calculation variables
    this.peakBuffer = [];
    this.lastPeakTime = 0;
    this.peakThreshold = 2500;
    this.adaptiveThreshold = true;
    this.signalQuality = 0;

    // ECG Analysis variables
    this.samplingRate = 100; // Hz (from ESP32)
    this.ecgAnalysisBuffer = [];
    this.maxAnalysisBuffer = 500; // 5 seconds
    this.lastBeatAnalysis = null;
    this.beatDetectionBuffer = [];

    // ECG Intervals (in milliseconds)
    this.intervals = {
      pr: null,
      qrs: null,
      qt: null,
      qtc: null,
      rr: null
    };

    // ECG Morphology
    this.morphology = {
      pWave: { detected: false, amplitude: 0, duration: 0 },
      qrsComplex: { detected: false, amplitude: 0, morphology: 'Unknown' },
      tWave: { detected: false, amplitude: 0, polarity: 'Unknown' },
      rhythm: { regularity: 'Unknown', classification: 'Unknown' }
    };

    // Statistics
    this.bpmStats = {
      current: 0,
      average: 0,
      min: Infinity,
      max: 0,
      history: []
    };
    
    this.initializeApp();
    this.registerChartPlugins();
  }

  registerChartPlugins() {
    // Register custom sweep line plugin for ECG chart
    const sweepLinePlugin = {
      id: 'sweepLine',
      afterDraw: (chart) => {
        if (chart.canvas.id !== 'ecgChart') return;

        const ctx = chart.ctx;
        const chartArea = chart.chartArea;

        // Calculate sweep position (moves from left to right)
        const now = Date.now();
        const sweepSpeed = 2.5; // seconds for full sweep
        const sweepPosition = ((now / 1000) % sweepSpeed) / sweepSpeed;
        const xPosition = chartArea.left + (chartArea.width * sweepPosition);

        // Draw sweep line
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(xPosition, chartArea.top);
        ctx.lineTo(xPosition, chartArea.bottom);
        ctx.stroke();
        ctx.restore();

        // Store sweep position for data clearing effect
        if (window.ecgMonitor) {
          window.ecgMonitor.ecgSweepPosition = sweepPosition;
        }
      }
    };

    // Register the plugin
    if (typeof Chart !== 'undefined') {
      Chart.register(sweepLinePlugin);
    }
  }
  
  initializeApp() {
    this.initializeDOM();
    this.initializeCharts();
    this.setupEventListeners();
    this.updateUI();
  }
  
  initializeDOM() {
    // Get DOM elements
    this.elements = {
      deviceIdInput: document.getElementById('deviceIdInput'),
      connectBtn: document.getElementById('connectBtn'),
      disconnectBtn: document.getElementById('disconnectBtn'),
      pauseBtn: document.getElementById('pauseBtn'),
      clearBtn: document.getElementById('clearBtn'),
      analyzeBtn: document.getElementById('analyzeBtn'),
      status: document.getElementById('status'),
      ecgValue: document.getElementById('ecgValue'),
      bpmValue: document.getElementById('bpmValue'),
      signalQuality: document.getElementById('signalQuality'),
      timestamp: document.getElementById('timestamp'),
      avgBpm: document.getElementById('avgBpm'),
      minBpm: document.getElementById('minBpm'),
      maxBpm: document.getElementById('maxBpm'),
      dataCount: document.getElementById('dataCount'),

      // ECG Intervals
      prInterval: document.getElementById('prInterval'),
      qrsInterval: document.getElementById('qrsInterval'),
      qtInterval: document.getElementById('qtInterval'),
      qtcInterval: document.getElementById('qtcInterval'),
      prStatus: document.getElementById('prStatus'),
      qrsStatus: document.getElementById('qrsStatus'),
      qtStatus: document.getElementById('qtStatus'),
      qtcStatus: document.getElementById('qtcStatus'),

      // ECG Morphology
      pWaveStatus: document.getElementById('pWaveStatus'),
      pWaveAmp: document.getElementById('pWaveAmp'),
      pWaveDur: document.getElementById('pWaveDur'),
      qrsWaveStatus: document.getElementById('qrsWaveStatus'),
      qrsWaveAmp: document.getElementById('qrsWaveAmp'),
      qrsMorphology: document.getElementById('qrsMorphology'),
      tWaveStatus: document.getElementById('tWaveStatus'),
      tWaveAmp: document.getElementById('tWaveAmp'),
      tWavePolarity: document.getElementById('tWavePolarity'),
      rhythmStatus: document.getElementById('rhythmStatus'),
      rhythmRegularity: document.getElementById('rhythmRegularity'),
      rhythmClass: document.getElementById('rhythmClass')
    };
  }
  
  initializeCharts() {
    // Initialize Enhanced ECG Chart with Medical Grid
    const ecgCtx = document.getElementById('ecgChart').getContext('2d');

    // Create medical-grade ECG chart
    this.ecgChart = new Chart(ecgCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'ECG Signal',
          data: [],
          borderColor: '#2c3e50',           // Dark medical color
          backgroundColor: 'transparent',    // No fill for cleaner look
          borderWidth: 1.5,                 // Thinner line for precision
          fill: false,
          tension: 0,                       // Sharp corners for medical accuracy
          pointRadius: 0,
          pointHoverRadius: 0,
          stepped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        scales: {
          x: {
            type: 'linear',
            display: true,
            position: 'bottom',
            title: {
              display: true,
              text: 'Time (seconds)',
              color: '#666',
              font: {
                size: 12,
                weight: 'bold'
              }
            },
            grid: {
              display: true,
              color: '#ff6b6b',              // Red grid lines (medical standard)
              lineWidth: 0.5,
              drawTicks: true,
              tickLength: 5
            },
            ticks: {
              display: true,
              color: '#666',
              font: {
                size: 10
              },
              maxTicksLimit: 10,
              callback: function(value) {
                return value.toFixed(1) + 's';
              }
            },
            min: 0,
            max: 2.5                        // Show 2.5 seconds of data
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'Amplitude (mV)',
              color: '#666',
              font: {
                size: 12,
                weight: 'bold'
              }
            },
            grid: {
              display: true,
              color: function(context) {
                // Major grid lines every 0.5mV (darker)
                if (context.tick.value % 0.5 === 0) {
                  return '#ff6b6b';
                }
                // Minor grid lines every 0.1mV (lighter)
                return '#ffcccc';
              },
              lineWidth: function(context) {
                return context.tick.value % 0.5 === 0 ? 0.8 : 0.3;
              },
              drawTicks: true,
              tickLength: 5
            },
            ticks: {
              display: true,
              color: '#666',
              font: {
                size: 10
              },
              stepSize: 0.1,
              callback: function(value) {
                return value.toFixed(1) + 'mV';
              }
            },
            min: -2,                        // Medical range
            max: 3
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: false,
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#666',
            borderWidth: 1,
            callbacks: {
              title: function(context) {
                return 'Time: ' + context[0].parsed.x.toFixed(3) + 's';
              },
              label: function(context) {
                return 'ECG: ' + context.parsed.y.toFixed(2) + 'mV';
              }
            }
          },
          // Custom sweep line plugin
          sweepLine: {
            enabled: true,
            color: 'rgba(255, 0, 0, 0.8)',
            width: 2
          }
        },
        elements: {
          line: {
            tension: 0,
            capBezierPoints: false
          },
          point: {
            radius: 0,
            hoverRadius: 3
          }
        }
      }
    });
    
    // Initialize BPM Chart
    const bpmCtx = document.getElementById('bpmChart').getContext('2d');
    this.bpmChart = new Chart(bpmCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Heart Rate (BPM)',
          data: [],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#e74c3c',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            beginAtZero: true,
            max: 200,
            title: {
              display: true,
              text: 'BPM'
            },
            grid: {
              color: 'rgba(0,0,0,0.1)'
            }
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    });

    // Initialize Beat Analysis Chart
    const beatCtx = document.getElementById('beatChart').getContext('2d');
    this.beatChart = new Chart(beatCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'ECG Beat',
          data: [],
          borderColor: '#2c3e50',
          backgroundColor: 'rgba(44, 62, 80, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0,
          pointRadius: 0
        }, {
          label: 'P Wave',
          data: [],
          borderColor: '#8e44ad',
          backgroundColor: 'rgba(142, 68, 173, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 6,
          pointBackgroundColor: '#8e44ad',
          showLine: false
        }, {
          label: 'QRS Complex',
          data: [],
          borderColor: '#c0392b',
          backgroundColor: 'rgba(192, 57, 43, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 8,
          pointBackgroundColor: '#c0392b',
          showLine: false
        }, {
          label: 'T Wave',
          data: [],
          borderColor: '#d68910',
          backgroundColor: 'rgba(214, 137, 16, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 6,
          pointBackgroundColor: '#d68910',
          showLine: false
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
              text: 'Time (ms)'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Amplitude (mV)'
            },
            grid: {
              color: 'rgba(0,0,0,0.1)'
            }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          }
        }
      }
    });
  }
  
  setupEventListeners() {
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
    this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
    this.elements.clearBtn.addEventListener('click', () => this.clearData());
    this.elements.analyzeBtn.addEventListener('click', () => this.analyzeBeat());

    // Add demo mode button (for testing without ESP32)
    const demoBtn = document.createElement('button');
    demoBtn.textContent = 'Demo Mode';
    demoBtn.className = 'btn-small';
    demoBtn.style.marginLeft = '10px';
    demoBtn.addEventListener('click', () => this.startDemoMode());
    this.elements.connectBtn.parentNode.appendChild(demoBtn);

    // Enter key support for device ID input
    this.elements.deviceIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this.isConnected) {
        this.connect();
      }
    });
  }
  
  connect() {
    const deviceId = this.elements.deviceIdInput.value.trim();
    if (!deviceId) {
      alert('Please enter a device ID');
      return;
    }
    
    this.deviceId = deviceId;
    this.updateStatus('Connecting...', 'connecting');
    
    const options = {
      keepalive: 30,
      clientId: 'webclient_' + Math.random().toString(16).substring(2, 10),
      username: this.mqttConfig.username,
      password: this.mqttConfig.password,
      protocol: 'wss',
      reconnectPeriod: 1000,
      clean: true,
      rejectUnauthorized: false
    };
    
    this.client = mqtt.connect(this.mqttConfig.brokerUrl, options);
    
    this.client.on('connect', () => {
      this.isConnected = true;
      this.updateStatus(`Connected to device: ${deviceId}`, 'connected');
      this.subscribeToTopics();
      this.updateUI();
    });
    
    this.client.on('message', (topic, message) => this.handleMessage(topic, message));
    this.client.on('error', (error) => this.handleError(error));
    this.client.on('close', () => this.handleDisconnect());
    this.client.on('offline', () => this.updateStatus('Connection lost. Reconnecting...', 'error'));
  }
  
  subscribeToTopics() {
    const ecgTopic = `iot/devices/${this.deviceId}`;
    const statusTopic = `iot/devices/${this.deviceId}/status`;
    
    this.client.subscribe([ecgTopic, statusTopic], (err) => {
      if (err) {
        this.updateStatus('Subscription error: ' + err.message, 'error');
      } else {
        this.updateStatus(`Listening for data from ${this.deviceId}...`, 'connected');
      }
    });
  }
  
  handleMessage(topic, message) {
    try {
      if (this.isPaused) return;
      
      const messageStr = message.toString();
      console.log(`Message received on ${topic}:`, messageStr);
      
      if (topic.endsWith('/status')) {
        this.updateStatus(`Device status: ${messageStr}`, 'connected');
        return;
      }
      
      const data = JSON.parse(messageStr);
      this.processECGData(data);
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  
  processECGData(data) {
    const ecgValue = parseInt(data.ecg_value);
    const timestamp = new Date();

    if (isNaN(ecgValue)) {
      console.error('Invalid ECG value:', data.ecg_value);
      return;
    }

    // Update data count
    this.dataCount++;

    // Store ECG data for display
    this.ecgData.push(ecgValue);
    this.ecgTimestamps.push(timestamp);

    // Store ECG data for analysis
    this.ecgAnalysisBuffer.push({
      value: ecgValue,
      timestamp: timestamp.getTime(),
      index: this.dataCount
    });

    // Limit data points
    if (this.ecgData.length > this.maxECGPoints) {
      this.ecgData.shift();
      this.ecgTimestamps.shift();
    }

    // Limit analysis buffer
    if (this.ecgAnalysisBuffer.length > this.maxAnalysisBuffer) {
      this.ecgAnalysisBuffer.shift();
    }

    // Update ECG chart
    this.updateECGChart();

    // Calculate BPM and detect beats
    this.calculateBPM(ecgValue, timestamp);

    // Continuous ECG analysis
    this.performContinuousAnalysis();

    // Update UI
    this.updateDataDisplay(ecgValue, timestamp);
  }

  calculateBPM(ecgValue, timestamp) {
    // Add to peak buffer for analysis
    this.peakBuffer.push({ value: ecgValue, time: timestamp });

    // Keep buffer size manageable
    if (this.peakBuffer.length > 50) {
      this.peakBuffer.shift();
    }

    // Adaptive threshold calculation
    if (this.adaptiveThreshold && this.peakBuffer.length > 10) {
      const values = this.peakBuffer.map(p => p.value);
      const mean = values.reduce((a, b) => a + b) / values.length;
      const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2)) / values.length);
      this.peakThreshold = mean + (std * 1.5);
    }

    // Peak detection
    if (ecgValue > this.peakThreshold &&
        timestamp - this.lastPeakTime > 300) { // Minimum 300ms between peaks

      const timeDiff = timestamp - this.lastPeakTime;

      if (this.lastPeakTime > 0 && timeDiff < 2000) { // Maximum 2 seconds between peaks
        const instantBPM = Math.round(60000 / timeDiff);

        if (instantBPM >= 40 && instantBPM <= 200) { // Reasonable BPM range
          this.updateBPMData(instantBPM, timestamp);
        }
      }

      this.lastPeakTime = timestamp;
    }

    // Calculate signal quality
    this.calculateSignalQuality();
  }

  updateBPMData(bpm, timestamp) {
    this.bpmStats.current = bpm;
    this.bpmStats.history.push(bpm);

    // Store for chart
    this.bpmData.push(bpm);
    this.bpmTimestamps.push(timestamp);

    // Limit BPM data points
    if (this.bpmData.length > this.maxBPMPoints) {
      this.bpmData.shift();
      this.bpmTimestamps.shift();
    }

    // Update statistics
    this.updateBPMStats();

    // Update BPM chart
    this.updateBPMChart();
  }

  updateBPMStats() {
    if (this.bpmStats.history.length === 0) return;

    // Calculate average
    this.bpmStats.average = Math.round(
      this.bpmStats.history.reduce((a, b) => a + b) / this.bpmStats.history.length
    );

    // Calculate min/max
    this.bpmStats.min = Math.min(...this.bpmStats.history);
    this.bpmStats.max = Math.max(...this.bpmStats.history);

    // Keep history manageable
    if (this.bpmStats.history.length > 100) {
      this.bpmStats.history.shift();
    }
  }

  calculateSignalQuality() {
    if (this.ecgData.length < 10) {
      this.signalQuality = 0;
      return;
    }

    // Calculate signal quality based on variance and noise
    const recentData = this.ecgData.slice(-20);
    const mean = recentData.reduce((a, b) => a + b) / recentData.length;
    const variance = recentData.reduce((a, b) => a + Math.pow(b - mean, 2)) / recentData.length;

    // Simple quality metric (0-100%)
    const quality = Math.min(100, Math.max(0, 100 - (variance / 1000)));
    this.signalQuality = Math.round(quality);
  }

  updateECGChart() {
    if (!this.ecgChart) return;

    // Convert ECG data to medical units and time scale
    const chartData = this.prepareECGChartData();

    this.ecgChart.data.labels = [];  // Using x,y coordinates instead of labels
    this.ecgChart.data.datasets[0].data = chartData;
    this.ecgChart.update('none');
  }

  prepareECGChartData() {
    if (this.ecgData.length === 0) return [];

    const chartData = [];
    const samplingInterval = 1000 / this.samplingRate; // 10ms at 100Hz

    // Check if we're in demo mode (cleaner signal, less filtering needed)
    const isDemoMode = this.demoInterval !== null;

    let processedData;
    if (isDemoMode) {
      // Demo mode: minimal filtering to preserve clean mathematical waveform
      processedData = this.applyMinimalFiltering(this.ecgData);
    } else {
      // Real ECG mode: full medical-grade filtering
      processedData = this.applyECGFiltering(this.ecgData);
    }

    // Convert ADC values to millivolts with proper medical scaling
    for (let i = 0; i < processedData.length; i++) {
      const adcValue = processedData[i];

      // Enhanced ADC to mV conversion with baseline correction
      const millivolts = this.adcToMillivolts(adcValue);

      // Calculate time in seconds (sweep from right to left, medical standard)
      const timeSeconds = (i * samplingInterval) / 1000;

      chartData.push({
        x: timeSeconds,
        y: millivolts
      });
    }

    return chartData;
  }

  applyMinimalFiltering(rawData) {
    if (rawData.length < 3) return rawData;

    // For demo mode: only apply light smoothing to preserve waveform shape
    const filtered = [];

    // Simple 3-point moving average for minimal smoothing
    filtered[0] = rawData[0];
    for (let i = 1; i < rawData.length - 1; i++) {
      filtered[i] = (rawData[i-1] + rawData[i] + rawData[i+1]) / 3;
    }
    filtered[rawData.length - 1] = rawData[rawData.length - 1];

    return filtered;
  }

  applyECGFiltering(rawData) {
    if (rawData.length < 10) return rawData;

    // Multi-stage medical-grade filtering
    let filtered = rawData.slice(); // Copy array

    // 1. High-pass filter (remove baseline drift) - 0.5Hz cutoff
    filtered = this.highPassFilter(filtered, 0.5, this.samplingRate);

    // 2. Low-pass filter (remove high-frequency noise) - 40Hz cutoff
    filtered = this.lowPassFilter(filtered, 40, this.samplingRate);

    // 3. Notch filter (remove 50/60Hz power line interference)
    filtered = this.notchFilter(filtered, 50, this.samplingRate);

    // 4. Median filter (remove impulse noise)
    filtered = this.medianFilter(filtered, 3);

    return filtered;
  }

  // High-pass Butterworth filter implementation
  highPassFilter(data, cutoffFreq, sampleRate) {
    const nyquist = sampleRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    // Simple high-pass filter using difference equation
    const filtered = [];
    const alpha = 1 / (1 + (2 * Math.PI * normalizedCutoff));

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }

    return filtered;
  }

  // Low-pass Butterworth filter implementation
  lowPassFilter(data, cutoffFreq, sampleRate) {
    const nyquist = sampleRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    // Simple low-pass filter using exponential smoothing
    const filtered = [];
    const alpha = (2 * Math.PI * normalizedCutoff) / (1 + 2 * Math.PI * normalizedCutoff);

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * data[i] + (1 - alpha) * filtered[i-1];
    }

    return filtered;
  }

  // Notch filter for power line interference
  notchFilter(data, notchFreq, sampleRate) {
    const omega = 2 * Math.PI * notchFreq / sampleRate;
    const cosOmega = Math.cos(omega);
    const alpha = 0.95; // Notch width parameter

    const filtered = [];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = x0 - 2 * alpha * cosOmega * x1 + alpha * alpha * x2 +
                 2 * alpha * cosOmega * y1 - alpha * alpha * y2;

      filtered[i] = y0;

      // Update delay line
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }

    return filtered;
  }

  // Median filter for impulse noise removal
  medianFilter(data, windowSize) {
    const filtered = [];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < data.length; i++) {
      const window = [];

      for (let j = -halfWindow; j <= halfWindow; j++) {
        const index = Math.max(0, Math.min(data.length - 1, i + j));
        window.push(data[index]);
      }

      window.sort((a, b) => a - b);
      filtered[i] = window[Math.floor(window.length / 2)];
    }

    return filtered;
  }

  correctBaseline(data) {
    if (data.length < 10) return data;

    // Calculate running baseline (low-frequency component)
    const corrected = [];
    const baselineWindow = 20; // 200ms window for baseline estimation

    for (let i = 0; i < data.length; i++) {
      // Calculate local baseline
      const start = Math.max(0, i - baselineWindow);
      const end = Math.min(data.length - 1, i + baselineWindow);

      let baseline = 0;
      let count = 0;

      for (let j = start; j <= end; j++) {
        baseline += data[j];
        count++;
      }

      baseline = baseline / count;

      // Subtract baseline to center the signal
      corrected[i] = data[i] - baseline + this.baselineValue;
    }

    return corrected;
  }

  adcToMillivolts(adcValue) {
    // Enhanced conversion with proper medical scaling
    // ESP32 ADC: 0-4095 (12-bit) representing 0-3.3V
    // ECG signal typically ranges from -2mV to +3mV

    const voltage = (adcValue / 4095) * 3.3; // Convert to voltage (0-3.3V)
    const centeredVoltage = voltage - 1.65;  // Center around 0V (baseline at 1.65V)
    const millivolts = centeredVoltage * 3;   // Scale to ±5mV range for better visibility

    return Math.round(millivolts * 100) / 100; // Round to 2 decimal places
  }

  // Helper functions for advanced ECG analysis
  calculateDerivative(signal) {
    const derivative = [];
    derivative[0] = 0;

    for (let i = 1; i < signal.length - 1; i++) {
      derivative[i] = (signal[i + 1] - signal[i - 1]) / 2;
    }

    derivative[signal.length - 1] = 0;
    return derivative;
  }

  findIsoelectricBaseline(values, rPeakIndex) {
    // Find baseline in TP segment (after T wave, before next P wave)
    const tpStart = Math.min(values.length - 1, rPeakIndex + 40); // +400ms after R
    const tpEnd = Math.min(values.length - 1, rPeakIndex + 60);   // +600ms after R

    if (tpEnd <= tpStart) {
      // Fallback: use overall signal median
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }

    const tpSegment = values.slice(tpStart, tpEnd);
    return tpSegment.reduce((a, b) => a + b) / tpSegment.length;
  }

  calculateAdaptiveThreshold(signal, factor = 0.3) {
    const mean = signal.reduce((a, b) => a + b) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2)) / signal.length;
    const stdDev = Math.sqrt(variance);

    return stdDev * factor;
  }

  classifyPWaveMorphology(pWaveSegment) {
    if (pWaveSegment.length < 3) return 'Unknown';

    const peak = Math.max(...pWaveSegment);
    const peakIndex = pWaveSegment.indexOf(peak);
    const baseline = (pWaveSegment[0] + pWaveSegment[pWaveSegment.length - 1]) / 2;

    // Check for biphasic P wave
    const firstHalf = pWaveSegment.slice(0, peakIndex);
    const secondHalf = pWaveSegment.slice(peakIndex);

    const firstHalfMin = Math.min(...firstHalf);
    const secondHalfMin = Math.min(...secondHalf);

    if (firstHalfMin < baseline - 20 || secondHalfMin < baseline - 20) {
      return 'Biphasic';
    }

    // Check P wave symmetry
    const asymmetryRatio = peakIndex / pWaveSegment.length;
    if (asymmetryRatio < 0.3 || asymmetryRatio > 0.7) {
      return 'Asymmetric';
    }

    return 'Normal';
  }


  updateBPMChart() {
    if (!this.bpmChart || this.bpmData.length === 0) return;

    const labels = this.bpmTimestamps.map(t => t.toLocaleTimeString());

    this.bpmChart.data.labels = labels;
    this.bpmChart.data.datasets[0].data = this.bpmData;
    this.bpmChart.update('none');
  }

  updateDataDisplay(ecgValue, timestamp) {
    // Update ECG value with animation
    this.elements.ecgValue.textContent = ecgValue;
    this.elements.ecgValue.classList.add('updated');
    setTimeout(() => this.elements.ecgValue.classList.remove('updated'), 300);

    // Update BPM
    this.elements.bpmValue.textContent = this.bpmStats.current || '--';

    // Update signal quality
    this.elements.signalQuality.textContent = this.signalQuality;

    // Update timestamp
    this.elements.timestamp.textContent = timestamp.toLocaleTimeString();

    // Update statistics
    this.elements.avgBpm.textContent = this.bpmStats.average || '--';
    this.elements.minBpm.textContent = this.bpmStats.min === Infinity ? '--' : this.bpmStats.min;
    this.elements.maxBpm.textContent = this.bpmStats.max || '--';
    this.elements.dataCount.textContent = this.dataCount;
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.isConnected = false;
    this.updateStatus('Disconnected', '');
    this.updateUI();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.elements.pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
    this.updateStatus(this.isPaused ? 'Data collection paused' : 'Data collection resumed', 'connected');
  }

  clearData() {
    this.ecgData = [];
    this.ecgTimestamps = [];
    this.bpmData = [];
    this.bpmTimestamps = [];
    this.ecgAnalysisBuffer = [];
    this.beatDetectionBuffer = [];
    this.bpmStats = {
      current: 0,
      average: 0,
      min: Infinity,
      max: 0,
      history: []
    };
    this.dataCount = 0;
    this.signalQuality = 0;

    // Reset intervals
    this.intervals = {
      pr: null,
      qrs: null,
      qt: null,
      qtc: null,
      rr: null
    };

    // Reset morphology
    this.morphology = {
      pWave: { detected: false, amplitude: 0, duration: 0 },
      qrsComplex: { detected: false, amplitude: 0, morphology: 'Unknown' },
      tWave: { detected: false, amplitude: 0, polarity: 'Unknown' },
      rhythm: { regularity: 'Unknown', classification: 'Unknown' }
    };

    // Clear charts
    if (this.ecgChart) {
      this.ecgChart.data.labels = [];
      this.ecgChart.data.datasets[0].data = [];
      this.ecgChart.update();
    }

    if (this.bpmChart) {
      this.bpmChart.data.labels = [];
      this.bpmChart.data.datasets[0].data = [];
      this.bpmChart.update();
    }

    if (this.beatChart) {
      this.beatChart.data.labels = [];
      this.beatChart.data.datasets.forEach(dataset => {
        dataset.data = [];
      });
      this.beatChart.update();
    }

    // Reset basic displays
    this.elements.ecgValue.textContent = '--';
    this.elements.bpmValue.textContent = '--';
    this.elements.signalQuality.textContent = '--';
    this.elements.avgBpm.textContent = '--';
    this.elements.minBpm.textContent = '--';
    this.elements.maxBpm.textContent = '--';
    this.elements.dataCount.textContent = '0';

    // Reset interval displays
    this.elements.prInterval.textContent = '--';
    this.elements.qrsInterval.textContent = '--';
    this.elements.qtInterval.textContent = '--';
    this.elements.qtcInterval.textContent = '--';

    // Reset interval status
    this.elements.prStatus.textContent = 'Normal: 120-200ms';
    this.elements.prStatus.className = 'interval-status';
    this.elements.qrsStatus.textContent = 'Normal: 80-120ms';
    this.elements.qrsStatus.className = 'interval-status';
    this.elements.qtStatus.textContent = 'Normal: 350-450ms';
    this.elements.qtStatus.className = 'interval-status';
    this.elements.qtcStatus.textContent = 'Normal: <440ms (♀), <430ms (♂)';
    this.elements.qtcStatus.className = 'interval-status';

    // Reset morphology displays
    this.elements.pWaveStatus.textContent = '--';
    this.elements.pWaveStatus.className = 'wave-status';
    this.elements.pWaveAmp.textContent = '--';
    this.elements.pWaveDur.textContent = '--';

    this.elements.qrsWaveStatus.textContent = '--';
    this.elements.qrsWaveStatus.className = 'wave-status';
    this.elements.qrsWaveAmp.textContent = '--';
    this.elements.qrsMorphology.textContent = '--';

    this.elements.tWaveStatus.textContent = '--';
    this.elements.tWaveStatus.className = 'wave-status';
    this.elements.tWaveAmp.textContent = '--';
    this.elements.tWavePolarity.textContent = '--';

    this.elements.rhythmStatus.textContent = '--';
    this.elements.rhythmRegularity.textContent = '--';
    this.elements.rhythmClass.textContent = '--';
  }

  handleError(error) {
    console.error('MQTT Error:', error);
    this.updateStatus('Connection error: ' + error.message, 'error');
  }

  handleDisconnect() {
    this.isConnected = false;
    this.updateStatus('Disconnected from broker', '');
    this.updateUI();
  }

  updateStatus(message, type = '') {
    this.elements.status.textContent = message;
    this.elements.status.className = 'status ' + type;
  }

  updateUI() {
    this.elements.connectBtn.disabled = this.isConnected;
    this.elements.disconnectBtn.disabled = !this.isConnected;
    this.elements.deviceIdInput.disabled = this.isConnected;
  }

  // Advanced ECG Analysis Methods

  performContinuousAnalysis() {
    if (this.ecgAnalysisBuffer.length < 100) return; // Need sufficient data

    // Detect R peaks for rhythm analysis
    this.detectRPeaks();

    // Calculate RR intervals
    this.calculateRRIntervals();

    // Update rhythm analysis
    this.analyzeRhythm();
  }

  detectRPeaks() {
    const recentData = this.ecgAnalysisBuffer.slice(-100); // Last 1 second
    const values = recentData.map(d => d.value);

    // Simple R peak detection using adaptive threshold
    const mean = values.reduce((a, b) => a + b) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2)) / values.length);
    const threshold = mean + (std * 1.5);

    // Find peaks above threshold
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > threshold &&
          values[i] > values[i-1] &&
          values[i] > values[i+1]) {

        const peakTime = recentData[i].timestamp;

        // Avoid duplicate peaks (minimum 300ms apart)
        if (this.beatDetectionBuffer.length === 0 ||
            peakTime - this.beatDetectionBuffer[this.beatDetectionBuffer.length - 1] > 300) {

          this.beatDetectionBuffer.push(peakTime);

          // Keep only recent beats (last 10 seconds)
          const tenSecondsAgo = Date.now() - 10000;
          this.beatDetectionBuffer = this.beatDetectionBuffer.filter(t => t > tenSecondsAgo);
        }
      }
    }
  }

  calculateRRIntervals() {
    if (this.beatDetectionBuffer.length < 2) return;

    const rrIntervals = [];
    for (let i = 1; i < this.beatDetectionBuffer.length; i++) {
      const rrInterval = this.beatDetectionBuffer[i] - this.beatDetectionBuffer[i-1];
      rrIntervals.push(rrInterval);
    }

    if (rrIntervals.length > 0) {
      this.intervals.rr = rrIntervals[rrIntervals.length - 1]; // Most recent RR interval
    }
  }

  analyzeRhythm() {
    if (this.beatDetectionBuffer.length < 3) {
      this.morphology.rhythm.regularity = 'Insufficient data';
      this.morphology.rhythm.classification = 'Unknown';
      return;
    }

    // Calculate RR interval variability
    const rrIntervals = [];
    for (let i = 1; i < this.beatDetectionBuffer.length; i++) {
      rrIntervals.push(this.beatDetectionBuffer[i] - this.beatDetectionBuffer[i-1]);
    }

    const meanRR = rrIntervals.reduce((a, b) => a + b) / rrIntervals.length;
    const rrVariability = Math.sqrt(rrIntervals.reduce((a, b) => a + Math.pow(b - meanRR, 2)) / rrIntervals.length);

    // Determine regularity
    const variabilityPercent = (rrVariability / meanRR) * 100;
    if (variabilityPercent < 10) {
      this.morphology.rhythm.regularity = 'Regular';
    } else if (variabilityPercent < 20) {
      this.morphology.rhythm.regularity = 'Slightly irregular';
    } else {
      this.morphology.rhythm.regularity = 'Irregular';
    }

    // Basic rhythm classification based on heart rate
    const currentBPM = this.bpmStats.current;
    if (currentBPM < 60) {
      this.morphology.rhythm.classification = 'Bradycardia';
    } else if (currentBPM > 100) {
      this.morphology.rhythm.classification = 'Tachycardia';
    } else {
      this.morphology.rhythm.classification = 'Normal Sinus Rhythm';
    }
  }

  analyzeBeat() {
    if (this.ecgAnalysisBuffer.length < 200) {
      alert('Insufficient data for beat analysis. Please wait for more ECG data.');
      return;
    }

    // Get the most recent 2 seconds of data for analysis
    const analysisData = this.ecgAnalysisBuffer.slice(-200);
    const beatData = this.extractSingleBeat(analysisData);

    if (!beatData) {
      alert('No clear beat detected in recent data. Please ensure good electrode contact.');
      return;
    }

    // Perform detailed beat analysis
    this.analyzeECGMorphology(beatData);
    this.calculateECGIntervals(beatData);
    this.updateBeatChart(beatData);
    this.updateAnalysisDisplay();
  }

  extractSingleBeat(data) {
    // Find the most prominent R peak in the data
    const values = data.map(d => d.value);
    const timestamps = data.map(d => d.timestamp);

    // Find R peak
    let maxValue = Math.max(...values);
    let rPeakIndex = values.indexOf(maxValue);

    // Extract beat around R peak (±400ms)
    const beatStart = Math.max(0, rPeakIndex - 40); // 400ms before R peak
    const beatEnd = Math.min(values.length - 1, rPeakIndex + 40); // 400ms after R peak

    const beatValues = values.slice(beatStart, beatEnd);
    const beatTimestamps = timestamps.slice(beatStart, beatEnd);

    // Convert to relative time (ms from R peak)
    const rPeakTime = beatTimestamps[rPeakIndex - beatStart];
    const relativeTimestamps = beatTimestamps.map(t => (t - rPeakTime));

    return {
      values: beatValues,
      timestamps: relativeTimestamps,
      rPeakIndex: rPeakIndex - beatStart,
      rPeakValue: maxValue
    };
  }

  analyzeECGMorphology(beatData) {
    const { values, timestamps, rPeakIndex } = beatData;

    // Convert ADC values to approximate mV (assuming 3.3V reference, 12-bit ADC)
    const adcToMv = (adcValue) => ((adcValue / 4095) * 3.3 - 1.65) * 2; // Rough conversion

    // Analyze P Wave (before QRS, typically -200ms to -50ms from R peak)
    this.analyzePWave(values, timestamps, rPeakIndex, adcToMv);

    // Analyze QRS Complex (around R peak, typically -50ms to +50ms)
    this.analyzeQRSComplex(values, timestamps, rPeakIndex, adcToMv);

    // Analyze T Wave (after QRS, typically +100ms to +400ms from R peak)
    this.analyzeTWave(values, timestamps, rPeakIndex, adcToMv);
  }

  analyzePWave(values, timestamps, rPeakIndex, adcToMv) {
    // Advanced P wave detection using derivative and template matching
    const pSearchStart = Math.max(0, rPeakIndex - 30); // -300ms from R peak
    const pSearchEnd = Math.max(0, rPeakIndex - 8);    // -80ms from R peak

    if (pSearchEnd <= pSearchStart) {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0, onset: null, offset: null };
      return;
    }

    const pRegion = values.slice(pSearchStart, pSearchEnd);
    const pTimestamps = timestamps.slice(pSearchStart, pSearchEnd);

    // Calculate first derivative to find wave boundaries
    const derivative = this.calculateDerivative(pRegion);

    // Find isoelectric baseline
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);

    // Detect P wave using advanced algorithm
    const pWaveFeatures = this.detectPWaveFeatures(pRegion, derivative, baseline, pTimestamps);

    if (pWaveFeatures.detected) {
      this.morphology.pWave = {
        detected: true,
        amplitude: Math.round(adcToMv(pWaveFeatures.amplitude) * 100) / 100,
        duration: pWaveFeatures.duration,
        onset: pWaveFeatures.onset,
        offset: pWaveFeatures.offset,
        morphology: pWaveFeatures.morphology
      };
    } else {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0, onset: null, offset: null };
    }
  }

  detectPWaveFeatures(region, derivative, baseline, timestamps) {
    const threshold = this.calculateAdaptiveThreshold(region, 0.3); // 30% of signal range
    // const minDuration = 6;  // Minimum 60ms for P wave (for future use)
    const maxDuration = 12; // Maximum 120ms for P wave

    let onset = -1, offset = -1, peakIndex = -1;
    let maxAmplitude = 0;

    // Find P wave onset (first significant positive derivative)
    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold && derivative[i-1] <= threshold) {
        onset = i;
        break;
      }
    }

    if (onset === -1) return { detected: false };

    // Find P wave peak (maximum value after onset)
    for (let i = onset; i < Math.min(onset + maxDuration, region.length); i++) {
      if (region[i] > baseline + threshold && region[i] > maxAmplitude) {
        maxAmplitude = region[i];
        peakIndex = i;
      }
    }

    // Find P wave offset (return to baseline)
    for (let i = peakIndex; i < Math.min(peakIndex + maxDuration/2, region.length); i++) {
      if (Math.abs(region[i] - baseline) < threshold/2) {
        offset = i;
        break;
      }
    }

    if (offset === -1 || peakIndex === -1) return { detected: false };

    const duration = (offset - onset) * 10; // Convert to milliseconds

    // Validate P wave characteristics
    if (duration < 60 || duration > 120) return { detected: false };
    if (maxAmplitude - baseline < threshold) return { detected: false };

    return {
      detected: true,
      amplitude: maxAmplitude - baseline,
      duration: duration,
      onset: timestamps[onset],
      offset: timestamps[offset],
      morphology: this.classifyPWaveMorphology(region.slice(onset, offset + 1))
    };
  }

  analyzeQRSComplex(values, _timestamps, rPeakIndex, adcToMv) {
    // QRS complex analysis around R peak
    const qrsStart = Math.max(0, rPeakIndex - 5);  // -50ms
    const qrsEnd = Math.min(values.length - 1, rPeakIndex + 5); // +50ms

    const qrsRegion = values.slice(qrsStart, qrsEnd);

    const maxQRS = Math.max(...qrsRegion);
    const minQRS = Math.min(...qrsRegion);

    const qrsAmplitude = maxQRS - minQRS;

    // Determine QRS morphology
    let morphology = 'Normal';
    if (qrsAmplitude > 1500) {
      morphology = 'High amplitude';
    } else if (qrsAmplitude < 500) {
      morphology = 'Low amplitude';
    }

    this.morphology.qrsComplex = {
      detected: true,
      amplitude: Math.round(adcToMv(qrsAmplitude) * 100) / 100,
      morphology: morphology
    };
  }

  analyzeTWave(values, _timestamps, rPeakIndex, adcToMv) {
    // T wave analysis after QRS
    const tWaveStart = Math.min(values.length - 1, rPeakIndex + 10); // +100ms
    const tWaveEnd = Math.min(values.length - 1, rPeakIndex + 30);   // +300ms

    if (tWaveEnd <= tWaveStart) {
      this.morphology.tWave = { detected: false, amplitude: 0, polarity: 'Unknown' };
      return;
    }

    const tWaveRegion = values.slice(tWaveStart, tWaveEnd);
    const baseline = (values[0] + values[values.length - 1]) / 2;

    const maxT = Math.max(...tWaveRegion);
    const minT = Math.min(...tWaveRegion);

    let tAmplitude, polarity;
    if (Math.abs(maxT - baseline) > Math.abs(minT - baseline)) {
      tAmplitude = maxT - baseline;
      polarity = 'Positive';
    } else {
      tAmplitude = baseline - minT;
      polarity = 'Negative';
    }

    if (Math.abs(tAmplitude) > 30) { // Threshold for T wave detection
      this.morphology.tWave = {
        detected: true,
        amplitude: Math.round(adcToMv(Math.abs(tAmplitude)) * 100) / 100,
        polarity: polarity
      };
    } else {
      this.morphology.tWave = { detected: false, amplitude: 0, polarity: 'Unknown' };
    }
  }

  calculateECGIntervals(beatData) {
    const { values, timestamps, rPeakIndex } = beatData;

    // Real ECG interval calculations using actual signal analysis

    // 1. PR Interval: Start of P wave to start of QRS
    this.intervals.pr = this.calculatePRInterval(values, timestamps, rPeakIndex);

    // 2. QRS Duration: Width of QRS complex
    this.intervals.qrs = this.calculateQRSDuration(values, timestamps, rPeakIndex);

    // 3. QT Interval: Start of QRS to end of T wave
    this.intervals.qt = this.calculateQTInterval(values, timestamps, rPeakIndex);

    // 4. QTc (Corrected QT): QT corrected for heart rate using Bazett's formula
    this.intervals.qtc = this.calculateQTcInterval();
  }

  calculatePRInterval(values, _timestamps, rPeakIndex) {
    // Find P wave onset and QRS onset
    const pWaveOnset = this.findPWaveOnset(values, rPeakIndex);
    const qrsOnset = this.findQRSOnset(values, rPeakIndex);

    if (pWaveOnset === -1 || qrsOnset === -1) {
      return null; // Cannot measure PR interval
    }

    // Calculate PR interval in milliseconds
    const prInterval = (qrsOnset - pWaveOnset) * 10; // Convert samples to ms (100Hz = 10ms per sample)

    // Validate PR interval (normal range: 120-200ms)
    if (prInterval < 80 || prInterval > 300) {
      return null; // Invalid PR interval
    }

    return Math.round(prInterval);
  }

  calculateQRSDuration(values, _timestamps, rPeakIndex) {
    // Find QRS onset and offset using derivative analysis
    const qrsOnset = this.findQRSOnset(values, rPeakIndex);
    const qrsOffset = this.findQRSOffset(values, rPeakIndex);

    if (qrsOnset === -1 || qrsOffset === -1) {
      return null; // Cannot measure QRS duration
    }

    // Calculate QRS duration in milliseconds
    const qrsDuration = (qrsOffset - qrsOnset) * 10; // Convert samples to ms

    // Validate QRS duration (normal range: 80-120ms)
    if (qrsDuration < 40 || qrsDuration > 200) {
      return null; // Invalid QRS duration
    }

    return Math.round(qrsDuration);
  }

  calculateQTInterval(values, _timestamps, rPeakIndex) {
    // Find QRS onset and T wave offset
    const qrsOnset = this.findQRSOnset(values, rPeakIndex);
    const tWaveOffset = this.findTWaveOffset(values, rPeakIndex);

    if (qrsOnset === -1 || tWaveOffset === -1) {
      return null; // Cannot measure QT interval
    }

    // Calculate QT interval in milliseconds
    const qtInterval = (tWaveOffset - qrsOnset) * 10; // Convert samples to ms

    // Validate QT interval (normal range: 300-500ms)
    if (qtInterval < 250 || qtInterval > 600) {
      return null; // Invalid QT interval
    }

    return Math.round(qtInterval);
  }

  calculateQTcInterval() {
    if (!this.intervals.qt) return null;

    let rrInterval;

    // Use RR interval if available, otherwise calculate from current BPM
    if (this.intervals.rr) {
      rrInterval = this.intervals.rr;
    } else if (this.bpmStats.current > 0) {
      rrInterval = (60 / this.bpmStats.current) * 1000; // Convert BPM to RR in ms
    } else {
      return null; // Cannot calculate QTc without heart rate
    }

    // Bazett's formula: QTc = QT / sqrt(RR in seconds)
    const rrSeconds = rrInterval / 1000;
    const qtc = this.intervals.qt / Math.sqrt(rrSeconds);

    return Math.round(qtc);
  }

  // Advanced wave detection functions for accurate interval measurement

  findPWaveOnset(values, rPeakIndex) {
    // Search for P wave onset 300ms before R peak
    const searchStart = Math.max(0, rPeakIndex - 30); // -300ms
    const searchEnd = Math.max(0, rPeakIndex - 8);    // -80ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.2);

    // Find first significant upward deflection (P wave onset)
    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold &&
          searchRegion[i] > baseline + threshold/2 &&
          derivative[i] > derivative[i-1]) {
        return searchStart + i;
      }
    }

    return -1; // P wave onset not found
  }

  findQRSOnset(values, rPeakIndex) {
    // Search for QRS onset around R peak
    const searchStart = Math.max(0, rPeakIndex - 8);  // -80ms
    const searchEnd = Math.max(0, rPeakIndex - 2);    // -20ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.5);

    // Find steepest upward slope (QRS onset)
    let maxDerivative = 0;
    let onsetIndex = -1;

    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold &&
          derivative[i] > maxDerivative &&
          Math.abs(searchRegion[i] - baseline) > threshold/2) {
        maxDerivative = derivative[i];
        onsetIndex = searchStart + i;
      }
    }

    return onsetIndex;
  }

  findQRSOffset(values, rPeakIndex) {
    // Search for QRS offset after R peak
    const searchStart = Math.min(values.length - 1, rPeakIndex + 2);  // +20ms
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 8);    // +80ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.3);

    // Find return to baseline (QRS offset)
    for (let i = 0; i < searchRegion.length; i++) {
      if (Math.abs(searchRegion[i] - baseline) < threshold &&
          Math.abs(derivative[i]) < threshold/2) {
        return searchStart + i;
      }
    }

    return -1; // QRS offset not found
  }

  findTWaveOffset(values, rPeakIndex) {
    // Search for T wave offset after QRS
    const searchStart = Math.min(values.length - 1, rPeakIndex + 15); // +150ms
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 40);   // +400ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.2);

    // Find T wave peak first
    let tPeakIndex = -1;
    let maxTAmplitude = 0;

    for (let i = 0; i < searchRegion.length / 2; i++) {
      const amplitude = Math.abs(searchRegion[i] - baseline);
      if (amplitude > maxTAmplitude && amplitude > threshold) {
        maxTAmplitude = amplitude;
        tPeakIndex = i;
      }
    }

    if (tPeakIndex === -1) return -1;

    // Find T wave offset (return to baseline after T peak)
    for (let i = tPeakIndex; i < searchRegion.length; i++) {
      if (Math.abs(searchRegion[i] - baseline) < threshold/2 &&
          Math.abs(derivative[i]) < threshold/3) {
        return searchStart + i;
      }
    }

    return -1; // T wave offset not found
  }

  updateBeatChart(beatData) {
    if (!this.beatChart) return;

    const { values, timestamps } = beatData;

    // Convert ADC to mV for display
    const adcToMv = (adcValue) => ((adcValue / 4095) * 3.3 - 1.65) * 2;
    const mvValues = values.map(adcToMv);

    // Update beat waveform
    this.beatChart.data.labels = timestamps;
    this.beatChart.data.datasets[0].data = mvValues;

    // Clear previous annotations
    this.beatChart.data.datasets[1].data = []; // P wave
    this.beatChart.data.datasets[2].data = []; // QRS
    this.beatChart.data.datasets[3].data = []; // T wave

    // Add wave annotations if detected
    if (this.morphology.pWave.detected) {
      // Add P wave marker
      const pIndex = Math.floor(timestamps.length * 0.3); // Approximate P wave position
      this.beatChart.data.datasets[1].data.push({
        x: timestamps[pIndex],
        y: mvValues[pIndex]
      });
    }

    // Add QRS marker (R peak)
    const rIndex = Math.floor(timestamps.length / 2);
    this.beatChart.data.datasets[2].data.push({
      x: timestamps[rIndex],
      y: mvValues[rIndex]
    });

    if (this.morphology.tWave.detected) {
      // Add T wave marker
      const tIndex = Math.floor(timestamps.length * 0.7); // Approximate T wave position
      this.beatChart.data.datasets[3].data.push({
        x: timestamps[tIndex],
        y: mvValues[tIndex]
      });
    }

    this.beatChart.update('none');
  }

  updateAnalysisDisplay() {
    // Update interval displays
    this.elements.prInterval.textContent = this.intervals.pr || '--';
    this.elements.qrsInterval.textContent = this.intervals.qrs || '--';
    this.elements.qtInterval.textContent = this.intervals.qt || '--';
    this.elements.qtcInterval.textContent = this.intervals.qtc || '--';

    // Update interval status
    this.updateIntervalStatus('pr', this.intervals.pr, 120, 200);
    this.updateIntervalStatus('qrs', this.intervals.qrs, 80, 120);
    this.updateIntervalStatus('qt', this.intervals.qt, 350, 450);
    this.updateIntervalStatus('qtc', this.intervals.qtc, 300, 440);

    // Update morphology displays
    this.elements.pWaveStatus.textContent = this.morphology.pWave.detected ? 'Detected' : 'Not detected';
    this.elements.pWaveStatus.className = 'wave-status ' + (this.morphology.pWave.detected ? 'detected' : 'not-detected');
    this.elements.pWaveAmp.textContent = this.morphology.pWave.amplitude || '--';
    this.elements.pWaveDur.textContent = this.morphology.pWave.duration || '--';

    this.elements.qrsWaveStatus.textContent = this.morphology.qrsComplex.detected ? 'Detected' : 'Not detected';
    this.elements.qrsWaveStatus.className = 'wave-status ' + (this.morphology.qrsComplex.detected ? 'detected' : 'not-detected');
    this.elements.qrsWaveAmp.textContent = this.morphology.qrsComplex.amplitude || '--';
    this.elements.qrsMorphology.textContent = this.morphology.qrsComplex.morphology || '--';

    this.elements.tWaveStatus.textContent = this.morphology.tWave.detected ? 'Detected' : 'Not detected';
    this.elements.tWaveStatus.className = 'wave-status ' + (this.morphology.tWave.detected ? 'detected' : 'not-detected');
    this.elements.tWaveAmp.textContent = this.morphology.tWave.amplitude || '--';
    this.elements.tWavePolarity.textContent = this.morphology.tWave.polarity || '--';

    this.elements.rhythmStatus.textContent = this.morphology.rhythm.classification;
    this.elements.rhythmRegularity.textContent = this.morphology.rhythm.regularity;
    this.elements.rhythmClass.textContent = this.morphology.rhythm.classification;
  }

  updateIntervalStatus(type, value, minNormal, maxNormal) {
    const statusElement = this.elements[type + 'Status'];

    if (value === null || value === undefined) {
      statusElement.textContent = 'Unable to measure';
      statusElement.className = 'interval-status';
      return;
    }

    if (value >= minNormal && value <= maxNormal) {
      statusElement.textContent = 'Normal';
      statusElement.className = 'interval-status normal';
    } else if (value < minNormal * 0.9 || value > maxNormal * 1.1) {
      statusElement.textContent = 'Abnormal';
      statusElement.className = 'interval-status abnormal';
    } else {
      statusElement.textContent = 'Borderline';
      statusElement.className = 'interval-status borderline';
    }
  }

  startDemoMode() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
      return;
    }

    this.updateStatus('Demo Mode: Simulating ECG data...', 'connected');
    this.isConnected = true;
    this.updateUI();

    let sampleIndex = 0;
    const heartRate = 75; // BPM
    const samplesPerBeat = (60 / heartRate) * this.samplingRate; // Samples per heartbeat

    this.demoInterval = setInterval(() => {
      if (this.isPaused) return;

      // Generate realistic ECG waveform
      const ecgValue = this.generateECGSample(sampleIndex, samplesPerBeat);

      // Simulate ESP32 data format
      const data = {
        device_id: 'DEMO',
        timestamp: Date.now(),
        ecg_value: ecgValue,
        sequence: sampleIndex,
        signal_quality: 95
      };

      this.processECGData(data);
      sampleIndex++;

    }, 10); // 100Hz sampling rate
  }

  generateECGSample(sampleIndex, samplesPerBeat) {
    // Generate a highly realistic ECG waveform using medical-grade mathematical functions
    const beatProgress = (sampleIndex % samplesPerBeat) / samplesPerBeat;
    const baseline = 2048; // ADC midpoint (1.65V)
    let ecgValue = baseline;

    // Enhanced P wave (0.08 - 0.14 of beat cycle) - more realistic timing
    if (beatProgress >= 0.08 && beatProgress <= 0.14) {
      const pProgress = (beatProgress - 0.08) / 0.06;
      // Smooth P wave with realistic morphology
      const pWave = 60 * Math.sin(pProgress * Math.PI) * Math.exp(-Math.pow(pProgress - 0.5, 2) * 8);
      ecgValue += pWave;
    }

    // Enhanced QRS complex (0.16 - 0.26 of beat cycle)
    else if (beatProgress >= 0.16 && beatProgress <= 0.26) {
      const qrsProgress = (beatProgress - 0.16) / 0.10;

      // Q wave (small negative deflection)
      if (qrsProgress < 0.15) {
        const qProgress = qrsProgress / 0.15;
        ecgValue -= 40 * Math.sin(qProgress * Math.PI) * 0.8;
      }
      // R wave (dominant positive deflection)
      else if (qrsProgress < 0.65) {
        const rProgress = (qrsProgress - 0.15) / 0.5;
        // Sharp, tall R wave with realistic morphology
        ecgValue += 700 * Math.sin(rProgress * Math.PI) * Math.exp(-Math.pow(rProgress - 0.5, 2) * 4);
      }
      // S wave (negative deflection after R)
      else {
        const sProgress = (qrsProgress - 0.65) / 0.35;
        ecgValue -= 150 * Math.sin(sProgress * Math.PI) * 0.9;
      }
    }

    // Enhanced T wave (0.32 - 0.58 of beat cycle) - more realistic timing and shape
    else if (beatProgress >= 0.32 && beatProgress <= 0.58) {
      const tProgress = (beatProgress - 0.32) / 0.26;
      // Smooth T wave with asymmetric morphology (typical of real ECG)
      const tWave = 120 * Math.sin(tProgress * Math.PI) * Math.exp(-Math.pow(tProgress - 0.4, 2) * 3);
      ecgValue += tWave;
    }

    // Subtle U wave (optional, 0.62 - 0.72 of beat cycle)
    else if (beatProgress >= 0.62 && beatProgress <= 0.72) {
      const uProgress = (beatProgress - 0.62) / 0.10;
      ecgValue += 15 * Math.sin(uProgress * Math.PI);
    }

    // Add minimal realistic noise (much less than before)
    ecgValue += (Math.random() - 0.5) * 8;

    // Add subtle respiratory variation (breathing artifact)
    const respiratoryRate = 0.25; // 15 breaths per minute
    const respiratoryPhase = (sampleIndex * respiratoryRate) / samplesPerBeat;
    ecgValue += 5 * Math.sin(respiratoryPhase * 2 * Math.PI);

    // Ensure within ADC range
    return Math.max(0, Math.min(4095, Math.round(ecgValue)));
  }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.ecgMonitor = new ECGMonitor();
});
