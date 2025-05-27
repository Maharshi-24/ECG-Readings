const connectBtn = document.getElementById('connectBtn');
const deviceIdInput = document.getElementById('deviceIdInput');
const statusDiv = document.getElementById('status');
const ecgValueDiv = document.getElementById('ecgValue');
const timestampDiv = document.getElementById('timestamp');

let client = null;
let ecgChart = null;
const maxDataPoints = 100;
let ecgData = [];
let labels = [];

// Setup Chart.js chart
function setupChart() {
  const ctx = document.getElementById('ecgChart').getContext('2d');
  ecgChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'ECG Value',
        data: ecgData,
        borderColor: 'red',
        borderWidth: 2,
        fill: false,
        tension: 0.2,
        pointRadius: 0
      }]
    },
    options: {
      animation: false,
      scales: {
        x: { display: false },
        y: { min: 0, max: 4095 }
      },
      plugins: {
        legend: { display: true }
      }
    }
  });
}

// Add data to chart and keep size limited
function addData(timestamp, ecgValue) {
  if (ecgData.length >= maxDataPoints) {
    ecgData.shift();
    labels.shift();
  }
  labels.push(new Date(timestamp).toLocaleTimeString());
  ecgData.push(ecgValue);
  ecgChart.update();
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

    statusDiv.textContent = `Connected to MQTT broker. Subscribed to ${ecgTopic} & ${statusTopic}`;

    client.subscribe(ecgTopic, (err) => {
      if (err) {
        statusDiv.textContent = 'ECG Subscription error: ' + err.message;
      }
    });

    client.subscribe(statusTopic, (err) => {
      if (err) {
        console.error('Status topic subscription error:', err.message);
      }
    });
  });

  client.on('error', (err) => {
    statusDiv.textContent = 'Connection error: ' + err.message;
    client.end();
  });

  client.on('message', (topic, message) => {
    try {
      if (topic.endsWith('/status')) {
        const statusMsg = message.toString();
        statusDiv.textContent = `Device status: ${statusMsg}`;
        return;
      }

      const data = JSON.parse(message.toString());
      ecgValueDiv.textContent = `ECG Value: ${data.ecg_value}`;
      timestampDiv.textContent = `Timestamp: ${new Date(data.timestamp).toLocaleTimeString()}`;
      addData(data.timestamp, data.ecg_value);
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  client.on('close', () => {
    statusDiv.textContent = 'Disconnected';
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
  ecgData = [];
  labels = [];
  if (ecgChart) {
    ecgChart.destroy();
  }
  setupChart();
  statusDiv.textContent = 'Connecting...';
  connectMQTT(deviceId);
});

// Initialize empty chart on page load
setupChart();
