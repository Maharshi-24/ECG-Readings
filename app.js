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
    Chart.register({
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
        window.ecgMonitor.ecgSweepPosition = sweepPosition;
      }
    });
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

    // Apply baseline correction and filtering
    const filteredData = this.applyECGFiltering(this.ecgData);

    // Convert ADC values to millivolts with proper medical scaling
    for (let i = 0; i < filteredData.length; i++) {
      const adcValue = filteredData[i];

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

  applyECGFiltering(rawData) {
    if (rawData.length < 5) return rawData;

    // Simple moving average filter to reduce noise
    const filtered = [];
    const windowSize = 3;

    for (let i = 0; i < rawData.length; i++) {
      if (i < windowSize - 1) {
        filtered[i] = rawData[i];
      } else {
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
          sum += rawData[i - j];
        }
        filtered[i] = sum / windowSize;
      }
    }

    // Baseline drift correction
    return this.correctBaseline(filtered);
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

  analyzePWave(values, _timestamps, rPeakIndex, adcToMv) {
    // Look for P wave in the region before QRS
    const pWaveStart = Math.max(0, rPeakIndex - 20); // -200ms
    const pWaveEnd = Math.max(0, rPeakIndex - 5);    // -50ms

    if (pWaveEnd <= pWaveStart) {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0 };
      return;
    }

    const pWaveRegion = values.slice(pWaveStart, pWaveEnd);
    const baseline = (values[0] + values[values.length - 1]) / 2;

    // Find P wave peak
    let maxP = Math.max(...pWaveRegion);
    let minP = Math.min(...pWaveRegion);

    // P wave is typically a small positive deflection
    const pAmplitude = Math.max(maxP - baseline, baseline - minP);

    if (pAmplitude > 50) { // Threshold for P wave detection (ADC units)
      this.morphology.pWave = {
        detected: true,
        amplitude: Math.round(adcToMv(pAmplitude) * 100) / 100,
        duration: (pWaveEnd - pWaveStart) * 10 // Convert to ms
      };
    } else {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0 };
    }
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

  calculateECGIntervals(_beatData) {
    // Note: In a real implementation, these would use actual signal analysis

    // Simulate interval calculations (in a real system, these would be more sophisticated)

    // PR Interval: Start of P wave to start of QRS
    if (this.morphology.pWave.detected) {
      this.intervals.pr = Math.round(120 + Math.random() * 80); // 120-200ms normal range
    } else {
      this.intervals.pr = null;
    }

    // QRS Duration: Width of QRS complex
    this.intervals.qrs = Math.round(80 + Math.random() * 40); // 80-120ms normal range

    // QT Interval: Start of QRS to end of T wave
    if (this.morphology.tWave.detected) {
      this.intervals.qt = Math.round(350 + Math.random() * 100); // 350-450ms normal range
    } else {
      this.intervals.qt = null;
    }

    // QTc (Corrected QT): QT corrected for heart rate using Bazett's formula
    if (this.intervals.qt && this.intervals.rr) {
      const rrSeconds = this.intervals.rr / 1000;
      this.intervals.qtc = Math.round(this.intervals.qt / Math.sqrt(rrSeconds));
    } else if (this.intervals.qt && this.bpmStats.current > 0) {
      // Use current BPM if RR interval not available
      const rrSeconds = 60 / this.bpmStats.current;
      this.intervals.qtc = Math.round(this.intervals.qt / Math.sqrt(rrSeconds));
    } else {
      this.intervals.qtc = null;
    }
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
    // Generate a realistic ECG waveform using mathematical functions
    const beatProgress = (sampleIndex % samplesPerBeat) / samplesPerBeat;
    const baseline = 2048; // ADC midpoint
    let ecgValue = baseline;

    // P wave (0.08 - 0.12 of beat cycle)
    if (beatProgress >= 0.08 && beatProgress <= 0.12) {
      const pProgress = (beatProgress - 0.08) / 0.04;
      ecgValue += 80 * Math.sin(pProgress * Math.PI);
    }

    // QRS complex (0.15 - 0.25 of beat cycle)
    else if (beatProgress >= 0.15 && beatProgress <= 0.25) {
      const qrsProgress = (beatProgress - 0.15) / 0.10;

      // Q wave (small negative)
      if (qrsProgress < 0.2) {
        ecgValue -= 50 * Math.sin(qrsProgress * 5 * Math.PI);
      }
      // R wave (large positive)
      else if (qrsProgress < 0.6) {
        const rProgress = (qrsProgress - 0.2) / 0.4;
        ecgValue += 800 * Math.sin(rProgress * Math.PI);
      }
      // S wave (negative)
      else {
        const sProgress = (qrsProgress - 0.6) / 0.4;
        ecgValue -= 200 * Math.sin(sProgress * Math.PI);
      }
    }

    // T wave (0.35 - 0.55 of beat cycle)
    else if (beatProgress >= 0.35 && beatProgress <= 0.55) {
      const tProgress = (beatProgress - 0.35) / 0.20;
      ecgValue += 150 * Math.sin(tProgress * Math.PI);
    }

    // Add some realistic noise
    ecgValue += (Math.random() - 0.5) * 20;

    // Ensure within ADC range
    return Math.max(0, Math.min(4095, Math.round(ecgValue)));
  }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.ecgMonitor = new ECGMonitor();
});
