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
    this.lastDataReceived = 0;
    this.connectionHeartbeat = null;
    this.dataCollectionStartTime = 0;
    this.continuousDataDuration = 0;
    
    // Data storage
    this.ecgData = [];
    this.ecgTimestamps = [];
    this.bpmData = [];
    this.bpmTimestamps = [];
    this.dataCount = 0;
    
    // Chart configuration
    this.maxECGPoints = 1000;     // Show last 10 seconds (1000 points at 100Hz)
    this.maxBPMPoints = 100;      // Show last 10 seconds (10 points per second)
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
    this.maxAnalysisBuffer = 1000; // 10 seconds for analysis
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

    // Device heartbeat monitoring
    this.lastDataReceived = 0;
    this.deviceHeartbeatInterval = null;
    this.deviceOnline = false;
    this.dataCount = 0;

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
              maxTicksLimit: 11,              // 0, 1, 2, ..., 10 seconds
              callback: function(value) {
                return value.toFixed(0) + 's';
              }
            },
            min: 0,
            max: 10                         // Show 10 seconds of data
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
              text: 'Time (10 seconds)'
            },
            grid: {
              color: 'rgba(0,0,0,0.2)',
              lineWidth: 1
            },
            ticks: {
              maxTicksLimit: 11, // 0-10 seconds
              callback: function(_value, index) {
                return index + 's';
              }
            }
          },
          y: {
            beginAtZero: true,
            max: 200,
            min: 40,
            title: {
              display: true,
              text: 'Heart Rate (BPM)'
            },
            grid: {
              color: 'rgba(0,0,0,0.1)',
              lineWidth: 1
            },
            ticks: {
              stepSize: 20
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
    // Navigation
    const recordingBtn = document.getElementById('recordingBtn');
    if (recordingBtn) {
      recordingBtn.addEventListener('click', () => {
        window.location.href = 'recording.html';
      });
    }

    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

    // Debug toggle
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    if (debugToggleBtn) {
      debugToggleBtn.addEventListener('click', () => this.toggleDebug());
    }

    // Test connection
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', () => this.testConnection());
    }
    this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
    this.elements.clearBtn.addEventListener('click', () => this.clearData());
    this.elements.analyzeBtn.addEventListener('click', () => this.analyzeBeat());

    // Real-time report functionality
    const generateRealtimeReportBtn = document.getElementById('generateRealtimeReportBtn');
    if (generateRealtimeReportBtn) {
      generateRealtimeReportBtn.addEventListener('click', () => this.showReportModal());
    }

    // Modal event listeners
    const closeReportModal = document.getElementById('closeReportModal');
    if (closeReportModal) {
      closeReportModal.addEventListener('click', () => this.hideReportModal());
    }

    const generateReportBtn = document.getElementById('generateReportBtn');
    if (generateReportBtn) {
      generateReportBtn.addEventListener('click', () => this.generateRealtimeReport());
    }

    const cancelReportBtn = document.getElementById('cancelReportBtn');
    if (cancelReportBtn) {
      cancelReportBtn.addEventListener('click', () => this.hideReportModal());
    }

    // Close modal when clicking outside
    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideReportModal();
        }
      });
    }

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
      this.showAlert('Please enter a device ID to connect to your ECG device', 'warning');
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
      console.log('MQTT broker connected successfully');
      this.updateStatus(`Connected to MQTT broker. Waiting for device ${deviceId}...`, 'connecting');
      this.subscribeToTopics();
      this.startConnectionHeartbeat();
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

    console.log(`Subscribing to topics: ${ecgTopic}, ${statusTopic}`);

    this.client.subscribe([ecgTopic, statusTopic], (err) => {
      if (err) {
        console.error('Subscription error:', err);
        this.updateStatus('Subscription error: ' + err.message, 'error');
      } else {
        console.log(`Successfully subscribed to topics for device ${this.deviceId}`);
        this.updateStatus(`Listening for data from ${this.deviceId}...`, 'connecting');
      }
    });
  }
  
  handleMessage(topic, message) {
    try {
      if (this.isPaused) return;

      const messageStr = message.toString();
      console.log(`Message received on ${topic}:`, messageStr);

      // Update last data received timestamp
      this.lastDataReceived = Date.now();

      // Track continuous data collection
      if (this.dataCollectionStartTime === 0) {
        this.dataCollectionStartTime = Date.now();
        this.continuousDataDuration = 0;
      } else {
        this.continuousDataDuration = Date.now() - this.dataCollectionStartTime;
      }

      // First data received - device is confirmed online
      if (!this.isConnected) {
        this.isConnected = true;
        this.updateStatus(`Connected to device: ${this.deviceId}`, 'connected');
        console.log('Device confirmed online - first data received');
        this.updateUI();
      }

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

  startConnectionHeartbeat() {
    // Clear any existing heartbeat
    if (this.connectionHeartbeat) {
      clearInterval(this.connectionHeartbeat);
    }

    // Start monitoring for device data
    this.connectionHeartbeat = setInterval(() => {
      const timeSinceLastData = Date.now() - this.lastDataReceived;

      // If no data received for 15 seconds and we think we're connected, mark as offline
      if (timeSinceLastData > 15000 && this.isConnected) {
        console.log('Device appears to be offline - no data for 15 seconds');
        this.isConnected = false;
        this.dataCollectionStartTime = 0;
        this.continuousDataDuration = 0;
        this.updateStatus(`Device ${this.deviceId} appears to be offline`, 'error');
        this.updateUI();
      }
    }, 5000); // Check every 5 seconds
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

      // Calculate time in seconds for 10-second window (newest data at right)
      const totalTimeWindow = 10; // 10 seconds
      const timeSeconds = totalTimeWindow - ((processedData.length - 1 - i) * samplingInterval) / 1000;

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

    // Create 10-second time scale labels
    const labels = [];
    const now = Date.now();

    // Generate labels for 10 seconds (0s to 10s)
    for (let i = 0; i <= 100; i++) {
      labels.push((i / 10).toFixed(1) + 's');
    }

    // Prepare data array with proper time alignment
    const chartData = new Array(101).fill(null);

    // Map BPM data to time positions
    this.bpmData.forEach((bpm, index) => {
      if (index < this.bpmTimestamps.length) {
        const timestamp = this.bpmTimestamps[index];
        const timeAgo = (now - timestamp) / 100; // Convert to deciseconds
        const position = Math.max(0, Math.min(100, Math.round(100 - timeAgo)));

        if (position >= 0 && position <= 100) {
          chartData[position] = bpm;
        }
      }
    });

    this.bpmChart.data.labels = labels;
    this.bpmChart.data.datasets[0].data = chartData;
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
    this.dataCollectionStartTime = 0;
    this.continuousDataDuration = 0;
    this.updateStatus('Disconnected from broker', '');

    // Clear heartbeat monitoring
    if (this.connectionHeartbeat) {
      clearInterval(this.connectionHeartbeat);
      this.connectionHeartbeat = null;
    }

    this.updateUI();
  }

  updateStatus(message, type = '') {
    this.elements.status.textContent = message;
    this.elements.status.className = 'status ' + type;

    // Update debug info
    this.updateDebugInfo();
  }

  updateDebugInfo() {
    const debugText = document.getElementById('debugText');
    if (debugText) {
      const timeSinceLastData = this.lastDataReceived ? Date.now() - this.lastDataReceived : 'Never';
      const continuousSeconds = Math.floor(this.continuousDataDuration / 1000);
      const debugInfo = `Device: ${this.deviceId} | Connected: ${this.isConnected} | Last Data: ${timeSinceLastData === 'Never' ? 'Never' : timeSinceLastData + 'ms ago'} | Continuous: ${continuousSeconds}s`;
      debugText.textContent = debugInfo;
    }
  }

  toggleDebug() {
    const debugInfo = document.getElementById('debugInfo');
    if (debugInfo) {
      const isVisible = debugInfo.style.display !== 'none';
      debugInfo.style.display = isVisible ? 'none' : 'block';
      this.updateDebugInfo();
    }
  }

  // Notification System
  showNotification(title, message, type = 'info', duration = 5000) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    notification.innerHTML = `
      <button class="notification-close">&times;</button>
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    `;

    // Add close functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
      this.removeNotification(notification);
    });

    // Auto-remove after duration
    setTimeout(() => {
      this.removeNotification(notification);
    }, duration);

    // Click to dismiss
    notification.addEventListener('click', () => {
      this.removeNotification(notification);
    });

    container.appendChild(notification);
  }

  removeNotification(notification) {
    if (notification && notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }
  }

  // Enhanced alert replacement
  showAlert(message, type = 'info') {
    const titles = {
      success: 'Success',
      warning: 'Warning',
      error: 'Error',
      info: 'Information'
    };

    this.showNotification(titles[type], message, type, type === 'error' ? 8000 : 5000);
  }

  testConnection() {
    const deviceId = this.elements.deviceIdInput.value.trim();
    if (!deviceId) {
      this.showAlert('Please enter a device ID first to test the connection', 'warning');
      return;
    }

    this.updateStatus('Testing MQTT connection...', 'connecting');

    // Create a test client
    const testClient = mqtt.connect(this.mqttConfig.brokerUrl, {
      username: this.mqttConfig.username,
      password: this.mqttConfig.password,
      clientId: `test-${Math.random().toString(16).substring(2, 10)}`,
      clean: true,
      connectTimeout: 10000
    });

    const timeout = setTimeout(() => {
      testClient.end();
      this.updateStatus('Connection test failed: Timeout', 'error');
    }, 15000);

    testClient.on('connect', () => {
      clearTimeout(timeout);
      this.updateStatus(`MQTT broker connection successful! Listening for device ${deviceId}...`, 'connected');

      // Subscribe to test topic
      const testTopic = `iot/devices/${deviceId}`;
      testClient.subscribe(testTopic, (err) => {
        if (err) {
          this.updateStatus(`Subscription failed: ${err.message}`, 'error');
        } else {
          this.updateStatus(`Successfully subscribed to ${testTopic}. Waiting for device data...`, 'connecting');

          // Listen for messages for 10 seconds
          const messageTimeout = setTimeout(() => {
            testClient.end();
            this.updateStatus(`No data received from device ${deviceId} in 10 seconds. Check device status.`, 'error');
          }, 10000);

          testClient.on('message', (_topic, message) => {
            clearTimeout(messageTimeout);
            testClient.end();
            this.updateStatus(`Device ${deviceId} is online and sending data!`, 'connected');
            console.log('Test message received:', message.toString());
          });
        }
      });
    });

    testClient.on('error', (error) => {
      clearTimeout(timeout);
      this.updateStatus(`Connection test failed: ${error.message}`, 'error');
      console.error('Test connection error:', error);
    });
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
    // Check if we have enough data for meaningful analysis
    const minRequiredPoints = Math.min(500, this.ecgAnalysisBuffer.length); // At least 5 seconds or whatever we have

    if (this.ecgAnalysisBuffer.length < 200) {
      this.showAlert('Insufficient data for beat analysis. Please wait for at least 2 seconds of ECG data.', 'warning');
      return;
    }

    // Check if we have been collecting data continuously
    if (this.continuousDataDuration < 2000) {
      const remainingTime = Math.ceil((2000 - this.continuousDataDuration) / 1000);
      this.showAlert(`Please wait ${remainingTime} more seconds for stable ECG data collection.`, 'warning');
      return;
    }

    // Get the available data for analysis (prefer 10 seconds, but work with what we have)
    const analysisData = this.ecgAnalysisBuffer.length >= 1000 ?
      this.ecgAnalysisBuffer.slice(-1000) :
      this.ecgAnalysisBuffer.slice(-minRequiredPoints);

    const beatData = this.extractSingleBeat(analysisData);

    if (!beatData) {
      this.showAlert('No clear heartbeat detected in recent data. Please ensure good electrode contact and stable signal.', 'warning');
      return;
    }

    // Perform detailed beat analysis
    this.analyzeECGMorphology(beatData);
    this.calculateECGIntervals(beatData);
    this.updateBeatChart(beatData);
    this.updateAnalysisDisplay();

    // Show success message
    const dataSeconds = Math.floor(analysisData.length / 100);
    this.showAlert(`Beat analysis completed successfully using ${dataSeconds} seconds of ECG data. Check the analysis panel for detailed results.`, 'success');
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

  // Real-time Report Methods
  showReportModal() {
    // Check if we have recent data (within last 10 seconds)
    const timeSinceLastData = Date.now() - this.lastDataReceived;

    if (!this.isConnected || timeSinceLastData > 10000) {
      this.showAlert('Cannot generate report: No ECG data received in the last 10 seconds. Please ensure device is connected and sending data.', 'error');
      return;
    }

    // Check if we have been collecting data continuously for at least 10 seconds
    if (this.continuousDataDuration < 10000) {
      const remainingTime = Math.ceil((10000 - this.continuousDataDuration) / 1000);
      this.showAlert(`Cannot generate report: Need ${remainingTime} more seconds of continuous ECG data. Please wait for the system to collect a full 10-second window.`, 'warning');
      return;
    }

    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.style.display = 'block';
      // Reset form
      document.getElementById('reportPatientName').value = '';
      document.getElementById('reportPatientAge').value = '';
      document.getElementById('reportPatientGender').value = '';
      // Hide report content
      document.querySelector('.report-form').style.display = 'block';
      document.getElementById('reportContent').style.display = 'none';
    }
  }

  hideReportModal() {
    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  async generateRealtimeReport() {
    const patientName = document.getElementById('reportPatientName').value.trim();
    const patientAge = document.getElementById('reportPatientAge').value;
    const patientGender = document.getElementById('reportPatientGender').value;

    if (!patientName) {
      this.showAlert('Please enter patient name to generate the report', 'warning');
      return;
    }

    // Hide form and show report
    document.querySelector('.report-form').style.display = 'none';
    document.getElementById('reportContent').style.display = 'block';

    // Generate report content
    const reportContent = await this.createRealtimeReportContent(patientName, patientAge, patientGender);
    document.getElementById('reportContent').innerHTML = reportContent;

    // Show success message
    this.showAlert(`ECG analysis report for ${patientName} has been generated successfully! You can now download it as PDF or print it.`, 'success');
  }

  async createRealtimeReportContent(patientName, patientAge, patientGender) {
    const currentTime = new Date();

    // Calculate statistics based on last 10 seconds of data
    const tenSecondStats = this.calculateTenSecondStatistics();

    // Capture ECG waveform screenshot
    const ecgScreenshot = await this.captureECGWaveform();
    const bpmScreenshot = await this.captureBPMChart();

    return `
      <div class="medical-report">
        <!-- Medical Report Header -->
        <div class="medical-header">
          <div class="header-top">
            <div class="facility-info">
              <h1>ELECTROCARDIOGRAM</h1>
              <div class="facility-name">ECG Monitoring System</div>
              <div class="facility-address">Real-Time Cardiac Analysis</div>
            </div>
            <div class="report-info">
              <div class="report-id">Report ID: ECG-${Date.now().toString().slice(-8)}</div>
              <div class="report-date">${currentTime.toLocaleDateString()}</div>
              <div class="report-time">${currentTime.toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        <!-- Patient Information Section -->
        <div class="patient-section">
          <div class="section-header">PATIENT INFORMATION</div>
          <div class="patient-grid">
            <div class="patient-field">
              <span class="field-label">Name:</span>
              <span class="field-value">${patientName}</span>
            </div>
            <div class="patient-field">
              <span class="field-label">Age:</span>
              <span class="field-value">${patientAge || 'Not specified'}</span>
            </div>
            <div class="patient-field">
              <span class="field-label">Gender:</span>
              <span class="field-value">${patientGender || 'Not specified'}</span>
            </div>
            <div class="patient-field">
              <span class="field-label">Device ID:</span>
              <span class="field-value">${this.deviceId}</span>
            </div>
            <div class="patient-field">
              <span class="field-label">Analysis Duration:</span>
              <span class="field-value">${tenSecondStats.duration} seconds</span>
            </div>
            <div class="patient-field">
              <span class="field-label">Data Points:</span>
              <span class="field-value">${tenSecondStats.dataPoints}</span>
            </div>
          </div>
        </div>

        <!-- ECG Measurements Section -->
        <div class="measurements-section">
          <div class="section-header">ECG MEASUREMENTS</div>
          <div class="measurements-grid">
            <div class="measurement-group">
              <div class="group-title">Heart Rate</div>
              <div class="measurement-item">
                <span class="measure-label">Rate:</span>
                <span class="measure-value">${tenSecondStats.heartRate || '--'}</span>
                <span class="measure-unit">BPM</span>
                <span class="measure-status ${this.getHeartRateStatus(tenSecondStats.heartRate)}">${this.getHeartRateStatusText(tenSecondStats.heartRate)}</span>
              </div>
            </div>

            <div class="measurement-group">
              <div class="group-title">Intervals</div>
              <div class="measurement-item">
                <span class="measure-label">PR:</span>
                <span class="measure-value">${tenSecondStats.intervals.pr || '--'}</span>
                <span class="measure-unit">ms</span>
                <span class="measure-status ${this.getIntervalStatusClass('pr', tenSecondStats.intervals.pr)}">${this.getIntervalStatus('pr', tenSecondStats.intervals.pr)}</span>
              </div>
              <div class="measurement-item">
                <span class="measure-label">QRS:</span>
                <span class="measure-value">${tenSecondStats.intervals.qrs || '--'}</span>
                <span class="measure-unit">ms</span>
                <span class="measure-status ${this.getIntervalStatusClass('qrs', tenSecondStats.intervals.qrs)}">${this.getIntervalStatus('qrs', tenSecondStats.intervals.qrs)}</span>
              </div>
              <div class="measurement-item">
                <span class="measure-label">QT:</span>
                <span class="measure-value">${tenSecondStats.intervals.qt || '--'}</span>
                <span class="measure-unit">ms</span>
                <span class="measure-status ${this.getIntervalStatusClass('qt', tenSecondStats.intervals.qt)}">${this.getIntervalStatus('qt', tenSecondStats.intervals.qt)}</span>
              </div>
              <div class="measurement-item">
                <span class="measure-label">QTc:</span>
                <span class="measure-value">${tenSecondStats.intervals.qtc || '--'}</span>
                <span class="measure-unit">ms</span>
                <span class="measure-status ${this.getIntervalStatusClass('qtc', tenSecondStats.intervals.qtc)}">${this.getIntervalStatus('qtc', tenSecondStats.intervals.qtc)}</span>
              </div>
            </div>

            <div class="measurement-group">
              <div class="group-title">Signal Quality</div>
              <div class="measurement-item">
                <span class="measure-label">Quality:</span>
                <span class="measure-value">${tenSecondStats.signalQuality}</span>
                <span class="measure-unit">%</span>
                <span class="measure-status ${this.getQualityStatusClass(tenSecondStats.signalQuality)}">${this.getQualityStatusText(tenSecondStats.signalQuality)}</span>
              </div>
              <div class="measurement-item">
                <span class="measure-label">R Peaks:</span>
                <span class="measure-value">${tenSecondStats.rPeakCount || 0}</span>
                <span class="measure-unit">detected</span>
                <span class="measure-status normal">Normal</span>
              </div>
            </div>
          </div>
        </div>
            <h3>PATIENT INFORMATION</h3>
            <div class="demo-grid">
              <div class="demo-item">
                <span class="demo-label">Name:</span>
                <span class="demo-value">${patientName}</span>
              </div>
              <div class="demo-item">
                <span class="demo-label">Age:</span>
                <span class="demo-value">${patientAge || 'Not specified'}</span>
              </div>
              <div class="demo-item">
                <span class="demo-label">Gender:</span>
                <span class="demo-value">${patientGender || 'Not specified'}</span>
              </div>
              <div class="demo-item">
                <span class="demo-label">Date:</span>
                <span class="demo-value">${currentTime.toLocaleDateString()}</span>
              </div>
              <div class="demo-item">
                <span class="demo-label">Time:</span>
                <span class="demo-value">${currentTime.toLocaleTimeString()}</span>
              </div>
              <div class="demo-item">
                <span class="demo-label">Device:</span>
                <span class="demo-value">${this.deviceId || 'Unknown'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Vital Signs and Measurements -->
        <div class="measurements-section">
          <h3>VITAL SIGNS & MEASUREMENTS</h3>
          <div class="measurements-table">
            <table class="medical-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Normal Range</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Heart Rate</td>
                  <td><strong>${tenSecondStats.heartRate || '--'} BPM</strong></td>
                  <td>60-100 BPM</td>
                  <td class="status-${this.getHeartRateStatus(tenSecondStats.heartRate)}">${this.getHeartRateStatusText(tenSecondStats.heartRate)}</td>
                </tr>
                <tr>
                  <td>Signal Quality</td>
                  <td><strong>${tenSecondStats.signalQuality}%</strong></td>
                  <td>≥ 80%</td>
                  <td class="status-${tenSecondStats.signalQuality >= 80 ? 'normal' : 'abnormal'}">${tenSecondStats.signalQuality >= 80 ? 'Good' : 'Poor'}</td>
                </tr>
                <tr>
                  <td>R Peaks Detected</td>
                  <td><strong>${tenSecondStats.rPeakCount || '--'}</strong></td>
                  <td>10-17 (10s)</td>
                  <td class="status-info">Detected</td>
                </tr>
                <tr>
                  <td>Analysis Duration</td>
                  <td><strong>${tenSecondStats.duration}s</strong></td>
                  <td>10s</td>
                  <td class="status-normal">Complete</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ECG Intervals -->
        <div class="intervals-section">
          <h3>ECG INTERVALS & DURATIONS</h3>
          <div class="intervals-table">
            <table class="medical-table">
              <thead>
                <tr>
                  <th>Interval</th>
                  <th>Measured Value</th>
                  <th>Normal Range</th>
                  <th>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>PR Interval</td>
                  <td><strong>${tenSecondStats.intervals.pr || '--'} ms</strong></td>
                  <td>120-200 ms</td>
                  <td class="status-${this.getIntervalStatusClass('pr', tenSecondStats.intervals.pr)}">${this.getIntervalStatus('pr', tenSecondStats.intervals.pr)}</td>
                </tr>
                <tr>
                  <td>QRS Duration</td>
                  <td><strong>${tenSecondStats.intervals.qrs || '--'} ms</strong></td>
                  <td>80-120 ms</td>
                  <td class="status-${this.getIntervalStatusClass('qrs', tenSecondStats.intervals.qrs)}">${this.getIntervalStatus('qrs', tenSecondStats.intervals.qrs)}</td>
                </tr>
                <tr>
                  <td>QT Interval</td>
                  <td><strong>${tenSecondStats.intervals.qt || '--'} ms</strong></td>
                  <td>350-450 ms</td>
                  <td class="status-${this.getIntervalStatusClass('qt', tenSecondStats.intervals.qt)}">${this.getIntervalStatus('qt', tenSecondStats.intervals.qt)}</td>
                </tr>
                <tr>
                  <td>QTc Interval</td>
                  <td><strong>${tenSecondStats.intervals.qtc || '--'} ms</strong></td>
                  <td>300-440 ms</td>
                  <td class="status-${this.getIntervalStatusClass('qtc', tenSecondStats.intervals.qtc)}">${this.getIntervalStatus('qtc', tenSecondStats.intervals.qtc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ECG Waveforms -->
        <div class="waveforms-section">
          <h3>ECG WAVEFORMS (10-SECOND ANALYSIS WINDOW)</h3>
          <div class="waveform-container">
            <div class="waveform-panel">
              <div class="waveform-header">
                <h4>Real-Time ECG Signal</h4>
                <div class="waveform-specs">
                  <span>Speed: 25mm/s</span>
                  <span>Gain: 10mm/mV</span>
                  <span>Filter: 0.5-40Hz</span>
                </div>
              </div>
              <div class="waveform-display">
                ${ecgScreenshot}
              </div>
            </div>
            <div class="waveform-panel">
              <div class="waveform-header">
                <h4>Heart Rate Trend</h4>
                <div class="waveform-specs">
                  <span>Duration: 10 seconds</span>
                  <span>Resolution: 0.1s</span>
                </div>
              </div>
              <div class="waveform-display">
                ${bpmScreenshot}
              </div>
            </div>
          </div>
        </div>

        <div class="morphology-analysis">
          <h4>Wave Morphology Analysis</h4>
          <div class="morphology-grid">
            <div class="morphology-item">
              <span class="morphology-label">P Wave:</span>
              <span class="morphology-value">${this.morphology.pWave.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.pWave.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">QRS Complex:</span>
              <span class="morphology-value">${this.morphology.qrsComplex.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.qrsComplex.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">T Wave:</span>
              <span class="morphology-value">${this.morphology.tWave.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.tWave.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">Rhythm:</span>
              <span class="morphology-value">${this.morphology.rhythm.regularity}</span>
              <span class="morphology-details">${this.morphology.rhythm.classification}</span>
            </div>
          </div>
        </div>

        <div class="clinical-interpretation">
          <h4>Clinical Interpretation</h4>
          ${this.generateClinicalInterpretation()}
        </div>

        <div class="report-actions">
          <button onclick="window.print()" class="btn-primary">Print Report</button>
          <button onclick="window.ecgMonitor.downloadReportPDF('${patientName}')" class="btn-secondary">Download PDF</button>
          <button onclick="window.ecgMonitor.hideReportModal()" class="btn-secondary">Close</button>
        </div>
      </div>
    `;
  }

  async captureECGWaveform() {
    try {
      const canvas = document.getElementById('ecgChart');
      if (canvas && window.html2canvas) {
        const chartContainer = canvas.parentElement;
        const screenshot = await html2canvas(chartContainer, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          allowTaint: true,
          width: chartContainer.offsetWidth,
          height: chartContainer.offsetHeight,
          scrollX: 0,
          scrollY: 0,
          windowWidth: chartContainer.offsetWidth,
          windowHeight: chartContainer.offsetHeight
        });
        return `<img src="${screenshot.toDataURL('image/png', 1.0)}" alt="ECG Waveform" style="width: 100%; height: auto; max-width: 800px;" />`;
      }
    } catch (error) {
      console.error('Error capturing ECG waveform:', error);
    }
    return '<p>ECG waveform capture not available</p>';
  }

  async captureBPMChart() {
    try {
      const canvas = document.getElementById('bpmChart');
      if (canvas && window.html2canvas) {
        const chartContainer = canvas.parentElement;
        const screenshot = await html2canvas(chartContainer, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          allowTaint: true,
          width: chartContainer.offsetWidth,
          height: chartContainer.offsetHeight,
          scrollX: 0,
          scrollY: 0,
          windowWidth: chartContainer.offsetWidth,
          windowHeight: chartContainer.offsetHeight
        });
        return `<img src="${screenshot.toDataURL('image/png', 1.0)}" alt="Heart Rate Trend" style="width: 100%; height: auto; max-width: 800px;" />`;
      }
    } catch (error) {
      console.error('Error capturing BPM chart:', error);
    }
    return '<p>Heart rate chart capture not available</p>';
  }

  getIntervalStatus(type, value) {
    if (!value) return 'Not measured';

    const ranges = {
      pr: { min: 120, max: 200 },
      qrs: { min: 80, max: 120 },
      qt: { min: 350, max: 450 },
      qtc: { min: 300, max: 440 }
    };

    const range = ranges[type];
    if (!range) return 'Unknown';

    if (value < range.min) return 'Short';
    if (value > range.max) return 'Prolonged';
    return 'Normal';
  }

  getIntervalStatusClass(type, value) {
    if (!value) return 'not-measured';

    const ranges = {
      pr: { min: 120, max: 200 },
      qrs: { min: 80, max: 120 },
      qt: { min: 350, max: 450 },
      qtc: { min: 300, max: 440 }
    };

    const range = ranges[type];
    if (!range) return 'unknown';

    if (value < range.min) return 'abnormal';
    if (value > range.max) return 'abnormal';
    return 'normal';
  }

  getHeartRateStatus(heartRate) {
    if (!heartRate) return 'unknown';
    if (heartRate < 60) return 'abnormal';
    if (heartRate > 100) return 'abnormal';
    return 'normal';
  }

  getHeartRateStatusText(heartRate) {
    if (!heartRate) return 'Not measured';
    if (heartRate < 60) return 'Bradycardia';
    if (heartRate > 100) return 'Tachycardia';
    return 'Normal';
  }

  getQualityStatusClass(quality) {
    if (quality >= 90) return 'excellent';
    if (quality >= 80) return 'normal';
    if (quality >= 70) return 'fair';
    return 'poor';
  }

  getQualityStatusText(quality) {
    if (quality >= 90) return 'Excellent';
    if (quality >= 80) return 'Good';
    if (quality >= 70) return 'Fair';
    return 'Poor';
  }

  getIntervalStatusClass(type, value) {
    if (!value) return 'info';

    const ranges = {
      pr: { min: 120, max: 200 },
      qrs: { min: 80, max: 120 },
      qt: { min: 350, max: 450 },
      qtc: { min: 300, max: 440 }
    };

    const range = ranges[type];
    if (!range) return 'info';

    if (value < range.min || value > range.max) return 'abnormal';
    return 'normal';
  }

  getHeartRateStatus(heartRate) {
    if (!heartRate) return 'info';
    if (heartRate < 60) return 'abnormal';
    if (heartRate > 100) return 'abnormal';
    return 'normal';
  }

  getHeartRateStatusText(heartRate) {
    if (!heartRate) return 'Not measured';
    if (heartRate < 60) return 'Bradycardia';
    if (heartRate > 100) return 'Tachycardia';
    return 'Normal';
  }

  generateClinicalInterpretation() {
    let interpretation = '<div class="clinical-notes">';

    // Heart rate interpretation
    const currentHR = this.bpmStats.current;
    if (currentHR) {
      if (currentHR < 60) {
        interpretation += '<p><strong>Bradycardia:</strong> Heart rate below 60 BPM detected.</p>';
      } else if (currentHR > 100) {
        interpretation += '<p><strong>Tachycardia:</strong> Heart rate above 100 BPM detected.</p>';
      } else {
        interpretation += '<p><strong>Normal Heart Rate:</strong> Heart rate within normal range (60-100 BPM).</p>';
      }
    }

    // Rhythm interpretation
    if (this.morphology.rhythm.regularity !== 'Unknown') {
      interpretation += `<p><strong>Rhythm:</strong> ${this.morphology.rhythm.regularity} rhythm detected.</p>`;
    }

    // Signal quality
    if (this.signalQuality < 70) {
      interpretation += '<p><strong>Signal Quality:</strong> Poor signal quality detected. Consider improving electrode contact.</p>';
    } else if (this.signalQuality > 90) {
      interpretation += '<p><strong>Signal Quality:</strong> Excellent signal quality achieved.</p>';
    }

    // Analysis window note
    interpretation += '<p><strong>Analysis Window:</strong> All calculations and measurements are based on the last 10 seconds of continuous ECG data.</p>';

    // Disclaimer
    interpretation += `
      <div class="disclaimer">
        <p><strong>Disclaimer:</strong> This analysis is for educational purposes only and should not be used for clinical diagnosis.
        Always consult with a qualified healthcare professional for medical interpretation of ECG results.</p>
      </div>
    `;

    interpretation += '</div>';
    return interpretation;
  }

  async downloadReportPDF(patientName) {
    if (!window.jspdf) {
      this.showAlert('PDF library not loaded. Please refresh the page and try again.', 'error');
      return;
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Get the 10-second statistics for the report
      const tenSecondStats = this.calculateTenSecondStatistics();
      const currentTime = new Date();

      // Set up document
      doc.setFontSize(20);
      doc.text('Real-Time ECG Analysis Report', 20, 20);

      // Patient information
      doc.setFontSize(14);
      doc.text('Patient Information', 20, 40);
      doc.setFontSize(12);
      doc.text(`Name: ${patientName}`, 20, 50);
      doc.text(`Date: ${currentTime.toLocaleDateString()}`, 20, 60);
      doc.text(`Time: ${currentTime.toLocaleTimeString()}`, 20, 70);

      // Analysis window information
      doc.setFontSize(14);
      doc.text('Analysis Details', 120, 40);
      doc.setFontSize(12);
      doc.text(`Analysis Window: ${tenSecondStats.duration} seconds`, 120, 50);
      doc.text(`Data Points: ${tenSecondStats.dataPoints}`, 120, 60);
      doc.text(`R Peaks Detected: ${tenSecondStats.rPeakCount || 0}`, 120, 70);
      doc.text(`Device: ${this.deviceId}`, 120, 80);

      // Vital signs
      doc.setFontSize(14);
      doc.text('Vital Signs (10-Second Analysis)', 20, 100);
      doc.setFontSize(12);
      doc.text(`Heart Rate: ${tenSecondStats.heartRate || '--'} BPM`, 20, 110);
      doc.text(`Signal Quality: ${tenSecondStats.signalQuality}%`, 20, 120);

      // ECG Intervals
      doc.setFontSize(14);
      doc.text('ECG Intervals', 20, 140);
      doc.setFontSize(12);
      doc.text(`PR Interval: ${tenSecondStats.intervals.pr || '--'} ms`, 20, 150);
      doc.text(`QRS Duration: ${tenSecondStats.intervals.qrs || '--'} ms`, 20, 160);
      doc.text(`QT Interval: ${tenSecondStats.intervals.qt || '--'} ms`, 20, 170);
      doc.text(`QTc Interval: ${tenSecondStats.intervals.qtc || '--'} ms`, 20, 180);

      // Add interval status
      doc.setFontSize(10);
      doc.text(`PR Status: ${this.getIntervalStatus('pr', tenSecondStats.intervals.pr)}`, 120, 150);
      doc.text(`QRS Status: ${this.getIntervalStatus('qrs', tenSecondStats.intervals.qrs)}`, 120, 160);
      doc.text(`QT Status: ${this.getIntervalStatus('qt', tenSecondStats.intervals.qt)}`, 120, 170);
      doc.text(`QTc Status: ${this.getIntervalStatus('qtc', tenSecondStats.intervals.qtc)}`, 120, 180);

      // Add waveform screenshots
      try {
        // Capture ECG waveform
        const ecgCanvas = document.getElementById('ecgChart');
        if (ecgCanvas && window.html2canvas) {
          doc.addPage();
          doc.setFontSize(14);
          doc.text('ECG Waveform (10 Seconds)', 20, 20);

          const ecgScreenshot = await html2canvas(ecgCanvas.parentElement, {
            backgroundColor: '#ffffff',
            scale: 1
          });

          const ecgImgData = ecgScreenshot.toDataURL('image/png');
          const ecgImgWidth = 170;
          const ecgImgHeight = (ecgScreenshot.height * ecgImgWidth) / ecgScreenshot.width;

          doc.addImage(ecgImgData, 'PNG', 20, 30, ecgImgWidth, Math.min(ecgImgHeight, 100));

          // Capture BPM chart
          const bpmCanvas = document.getElementById('bpmChart');
          if (bpmCanvas) {
            const bpmScreenshot = await html2canvas(bpmCanvas.parentElement, {
              backgroundColor: '#ffffff',
              scale: 1
            });

            const bpmImgData = bpmScreenshot.toDataURL('image/png');
            const bpmImgWidth = 170;
            const bpmImgHeight = (bpmScreenshot.height * bpmImgWidth) / bpmScreenshot.width;

            doc.text('Heart Rate Trend (10 Seconds)', 20, 150);
            doc.addImage(bpmImgData, 'PNG', 20, 160, bpmImgWidth, Math.min(bpmImgHeight, 80));
          }
        }
      } catch (error) {
        console.error('Error adding waveform screenshots:', error);
        doc.addPage();
        doc.setFontSize(12);
        doc.text('Waveform screenshots could not be captured.', 20, 20);
      }

      // Add clinical notes
      doc.addPage();
      doc.setFontSize(14);
      doc.text('Clinical Interpretation', 20, 20);
      doc.setFontSize(10);

      let yPos = 30;

      // Heart rate interpretation
      const currentHR = tenSecondStats.heartRate;
      if (currentHR) {
        if (currentHR < 60) {
          doc.text('• Bradycardia detected (HR < 60 BPM)', 20, yPos);
        } else if (currentHR > 100) {
          doc.text('• Tachycardia detected (HR > 100 BPM)', 20, yPos);
        } else {
          doc.text('• Normal heart rate range (60-100 BPM)', 20, yPos);
        }
        yPos += 10;
      }

      // Signal quality
      if (tenSecondStats.signalQuality < 70) {
        doc.text('• Poor signal quality - consider improving electrode contact', 20, yPos);
        yPos += 10;
      } else if (tenSecondStats.signalQuality > 90) {
        doc.text('• Excellent signal quality achieved', 20, yPos);
        yPos += 10;
      }

      // Analysis window note
      yPos += 10;
      doc.text('Analysis Window: All calculations based on last 10 seconds of continuous ECG data.', 20, yPos);

      // Disclaimer
      yPos += 20;
      doc.setFontSize(8);
      doc.text('DISCLAIMER: This analysis is for educational purposes only and should not be used for clinical', 20, yPos);
      yPos += 8;
      doc.text('diagnosis. Always consult with a qualified healthcare professional for medical interpretation.', 20, yPos);

      // Save the PDF
      const fileName = `ecg_report_${patientName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      doc.save(fileName);

      // Show success notification
      this.showAlert(`ECG report for ${patientName} has been downloaded successfully!`, 'success');

    } catch (error) {
      console.error('Error generating PDF:', error);
      this.showAlert('Error generating PDF: ' + error.message, 'error');
    }
  }

  calculateTenSecondStatistics() {
    // Get last 10 seconds of ECG data (1000 points at 100Hz)
    const tenSecondData = this.ecgAnalysisBuffer.slice(-1000);

    if (tenSecondData.length < 1000) {
      return {
        dataPoints: tenSecondData.length,
        duration: tenSecondData.length / 100, // seconds
        heartRate: this.bpmStats.current || 0,
        intervals: { ...this.intervals },
        morphology: { ...this.morphology },
        signalQuality: this.signalQuality
      };
    }

    // Calculate heart rate from 10-second window
    const values = tenSecondData.map(d => d.value);
    const timestamps = tenSecondData.map(d => d.timestamp);

    // Find R peaks in 10-second window
    const rPeaks = this.findRPeaksInWindow(values, timestamps);
    const avgHeartRate = this.calculateAverageHeartRateFromPeaks(rPeaks);

    // Calculate intervals from the most recent complete beat
    const recentIntervals = this.calculateIntervalsFromWindow(values, rPeaks);

    return {
      dataPoints: tenSecondData.length,
      duration: 10,
      heartRate: avgHeartRate,
      intervals: recentIntervals,
      morphology: { ...this.morphology },
      signalQuality: this.signalQuality,
      rPeakCount: rPeaks.length
    };
  }

  findRPeaksInWindow(values, timestamps) {
    const peaks = [];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const threshold = mean + Math.sqrt(variance) * 1.5;

    for (let i = 10; i < values.length - 10; i++) {
      if (values[i] > threshold) {
        let isLocalMax = true;
        for (let j = i - 5; j <= i + 5; j++) {
          if (j !== i && values[j] >= values[i]) {
            isLocalMax = false;
            break;
          }
        }
        if (isLocalMax) {
          peaks.push({ index: i, timestamp: timestamps[i], value: values[i] });
          i += 30; // Skip next 300ms to avoid double detection
        }
      }
    }

    return peaks;
  }

  calculateAverageHeartRateFromPeaks(peaks) {
    if (peaks.length < 2) return this.bpmStats.current || 0;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i].timestamp - peaks[i-1].timestamp;
      if (interval >= 300 && interval <= 2000) { // Valid RR intervals
        intervals.push(interval);
      }
    }

    if (intervals.length === 0) return this.bpmStats.current || 0;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(60000 / avgInterval);
  }

  calculateIntervalsFromWindow(values, peaks) {
    if (peaks.length === 0) return { ...this.intervals };

    // Use the most recent R peak for interval calculation
    const lastPeak = peaks[peaks.length - 1];
    const rIndex = lastPeak.index;

    // Calculate intervals similar to existing method but from 10-second window
    const pr = this.calculatePRFromWindow(values, rIndex);
    const qrs = this.calculateQRSFromWindow(values, rIndex);
    const qt = this.calculateQTFromWindow(values, rIndex);
    const qtc = qt && this.bpmStats.current ?
      Math.round(qt / Math.sqrt((60 / this.bpmStats.current))) : null;

    return { pr, qrs, qt, qtc, rr: null };
  }

  calculatePRFromWindow(values, rIndex) {
    // Similar to existing PR calculation but adapted for window
    const searchStart = Math.max(0, rIndex - 20);
    const searchEnd = Math.max(0, rIndex - 8);

    if (searchEnd <= searchStart) return this.intervals.pr;

    // Find P wave in search region
    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    let maxPAmplitude = 0;
    let pIndex = -1;

    for (let i = searchStart; i < searchEnd; i++) {
      const amplitude = Math.abs(values[i] - baseline);
      if (amplitude > maxPAmplitude && amplitude > 50) {
        maxPAmplitude = amplitude;
        pIndex = i;
      }
    }

    if (pIndex === -1) return this.intervals.pr;

    const prInterval = (rIndex - pIndex - 3) * 10; // Convert to ms
    return (prInterval >= 80 && prInterval <= 300) ? Math.round(prInterval) : this.intervals.pr;
  }

  calculateQRSFromWindow(values, rIndex) {
    // Similar to existing QRS calculation
    const qrsStart = Math.max(0, rIndex - 5);
    const qrsEnd = Math.min(values.length - 1, rIndex + 8);

    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const threshold = 30;

    let qrsOnset = rIndex;
    for (let i = rIndex - 1; i >= qrsStart; i--) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOnset = i;
        break;
      }
    }

    let qrsOffset = rIndex;
    for (let i = rIndex + 1; i <= qrsEnd; i++) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOffset = i;
        break;
      }
    }

    const qrsDuration = (qrsOffset - qrsOnset) * 10;
    return (qrsDuration >= 40 && qrsDuration <= 200) ? Math.round(qrsDuration) : this.intervals.qrs;
  }

  calculateQTFromWindow(values, rIndex) {
    // Similar to existing QT calculation
    const searchStart = Math.min(values.length - 1, rIndex + 10);
    const searchEnd = Math.min(values.length - 1, rIndex + 50);

    if (searchEnd <= searchStart) return this.intervals.qt;

    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;

    let tWaveEnd = -1;
    for (let i = searchEnd; i >= searchStart; i--) {
      if (Math.abs(values[i] - baseline) < 30) {
        tWaveEnd = i;
        break;
      }
    }

    if (tWaveEnd === -1) return this.intervals.qt;

    const qtInterval = (tWaveEnd - rIndex + 5) * 10;
    return (qtInterval >= 250 && qtInterval <= 600) ? Math.round(qtInterval) : this.intervals.qt;
  }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.ecgMonitor = new ECGMonitor();
});
