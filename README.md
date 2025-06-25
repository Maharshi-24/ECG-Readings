# ECG Real-Time Monitor

A comprehensive real-time ECG monitoring system using ESP32 microcontroller and web-based dashboard.

## 🏥 Features

### Core Monitoring
- **Real-time ECG signal visualization**
- **Heart rate calculation and trending**
- **Signal quality monitoring**
- **Lead-off detection**
- **MQTT communication via HiveMQ Cloud**
- **Responsive web dashboard**

### Advanced ECG Analysis
- **PR Interval measurement** (120-200ms normal range)
- **QRS Duration analysis** (80-120ms normal range)
- **QT Interval calculation** (350-450ms normal range)
- **QTc (Corrected QT) using Bazett's formula**
- **ECG morphology detection** (P wave, QRS complex, T wave)
- **Rhythm analysis** (regularity and classification)
- **Beat-by-beat analysis** with detailed waveform breakdown
- **Automated interval status** (Normal/Borderline/Abnormal)

### Statistical Analysis
- **Real-time statistics** (min, max, average BPM)
- **Signal quality assessment**
- **Wave amplitude measurements**
- **Rhythm regularity analysis**
- **Data export capabilities**

## 🔧 Hardware Requirements

- ESP32 Development Board
- ECG sensor module (AD8232 or similar)
- Electrodes and leads
- Breadboard and jumper wires

## 📋 Pin Configuration

| ESP32 Pin | ECG Module Pin | Description |
|-----------|----------------|-------------|
| GPIO 34   | OUTPUT         | ECG Signal Output |
| GPIO 32   | LO+            | Lead Off Detection + |
| GPIO 33   | LO-            | Lead Off Detection - |
| 3.3V      | VCC            | Power Supply |
| GND       | GND            | Ground |

## 🚀 Quick Start

### 1. ESP32 Setup

1. Open `ESP32/EGC-Code/EGC-Code.ino` in Arduino IDE
2. Install required libraries:
   - WiFi
   - WiFiClientSecure
   - PubSubClient
   - ArduinoJson
3. Update WiFi credentials if needed:
   ```cpp
   const char* ssid = "Maharshi";
   const char* password = "MSD240604";
   ```
4. Upload the code to your ESP32

### 2. Web Dashboard Setup

1. Make sure Node.js is installed on your system
2. Navigate to the project directory
3. Start the web server:
   ```bash
   npm start
   ```
   or
   ```bash
   node server.js
   ```
4. Open your browser and go to: `http://localhost:3000`

### 3. Choose Your Mode

**Real-Time Monitor** (`http://localhost:3000/`)
- Continuous ECG monitoring
- Real-time heart rate analysis
- Beat-by-beat analysis
- Demo mode available

**Multi-Lead Recording** (`http://localhost:3000/recording.html`)
- 10-second ECG recordings
- Multi-lead simulation (3, 6, or 12 leads)
- Professional ECG reports
- PDF export capabilities

## 📊 Multi-Lead Recording System

### New 10-Second Recording Features
- **Precise Timing**: Exactly 10-second recordings for each lead position
- **Multi-Lead Simulation**: Simulate 12-lead ECG using 3-electrode setup
- **Electrode Positioning Guide**: Step-by-step guidance for each lead placement
- **Session Management**: Complete recording sessions with patient information
- **Comprehensive Reports**: Detailed ECG analysis with clinical interpretation
- **Professional Export**: PDF reports and raw data export

### How to Use Multi-Lead Recording

1. **Setup Recording Session**
   - Navigate to Multi-Lead Recording page
   - Enter patient information (name, age, gender)
   - Select number of lead positions (3, 6, or 12)
   - Choose between real device connection or demo mode

2. **Record ECG Leads**
   - Follow electrode placement instructions for each lead
   - Ensure good signal quality before recording
   - Click "Start 10s Recording" for each position
   - System automatically progresses through all lead positions

3. **Generate Professional Reports**
   - Review all completed recordings
   - Generate comprehensive analysis report
   - Export as professional PDF or raw JSON data

### Lead Configurations

**3-Lead Basic Configuration:**
- Lead I: Right arm (-) to Left arm (+)
- Lead II: Right arm (-) to Left leg (+)
- Lead III: Left arm (-) to Left leg (+)

**6-Lead Extended Configuration:**
- Standard limb leads (I, II, III)
- Augmented leads (aVR, aVL, aVF)

**12-Lead Full Simulation:**
- Standard and augmented limb leads
- Precordial leads V1-V6 (simulated with chest placements)

### Report Features
- Patient demographics and session information
- Lead-by-lead analysis with heart rate and signal quality
- Clinical interpretation and automated status indicators
- Professional formatting suitable for medical documentation

## 🌐 MQTT Configuration

The system uses HiveMQ Cloud for MQTT communication:

- **Broker**: `2a086fbdeb91453eacd25659758b74f3.s1.eu.hivemq.cloud`
- **Port**: 8883 (TLS) for ESP32, 8884 (WSS) for web client
- **Username**: `maharshi`
- **Password**: `Maharshi24`

### MQTT Topics

- `iot/devices/ECG1` - ECG data stream
- `iot/devices/ECG1/status` - Device status updates
- `iot/devices/ECG1/heartbeat` - Device health monitoring
- `iot/devices/ECG1/capabilities` - Device specifications

## 📊 Data Format

### ECG Data Message
```json
{
  "device_id": "ECG1",
  "timestamp": 1234567890,
  "ecg_value": 2048,
  "sequence": 1001,
  "signal_quality": 95
}
```

### Status Message
```json
{
  "status": "online",
  "device_id": "ECG1",
  "ip": "192.168.1.100",
  "rssi": -45,
  "timestamp": 1234567890
}
```

## 🎛️ Web Dashboard Controls

### Connection Controls
- **Connect/Disconnect**: Establish MQTT connection
- **Pause/Resume**: Temporarily stop data collection
- **Clear**: Reset all charts and statistics
- **Device ID**: Specify which ESP32 device to monitor

### Analysis Controls
- **Analyze Beat**: Perform detailed analysis of the most recent ECG beat
- **Real-time Analysis**: Continuous rhythm and morphology monitoring

## 📈 Monitoring Features

### Real-time Charts
- **ECG Signal**: Live waveform display (200 data points)
- **Heart Rate Trend**: BPM over time (60 seconds)
- **Beat Analysis**: Detailed single-beat waveform with P, QRS, T wave markers

### ECG Interval Analysis
- **PR Interval**: Atrial conduction time measurement
- **QRS Duration**: Ventricular depolarization time
- **QT Interval**: Total ventricular activity duration
- **QTc Interval**: Heart rate corrected QT interval
- **Automated Status**: Color-coded normal/abnormal indicators

### ECG Morphology Analysis
- **P Wave Detection**: Atrial depolarization analysis
  - Amplitude measurement (mV)
  - Duration calculation (ms)
- **QRS Complex Analysis**: Ventricular depolarization
  - Amplitude measurement (mV)
  - Morphology classification
- **T Wave Detection**: Ventricular repolarization
  - Amplitude measurement (mV)
  - Polarity determination
- **Rhythm Analysis**: Heart rhythm assessment
  - Regularity evaluation
  - Basic arrhythmia classification

### Statistics
- Current BPM with trend analysis
- Average, minimum, maximum BPM
- Signal quality percentage
- Wave amplitude measurements
- Interval timing statistics
- Total data points received

### Status Indicators
- Connection status with real-time updates
- Lead-off detection with alerts
- Signal quality assessment
- Wave detection status
- Interval measurement validity
- Last update timestamp

## 🔧 Troubleshooting

### ESP32 Issues
- Check WiFi credentials
- Verify MQTT broker connectivity
- Ensure proper electrode connections
- Monitor serial output for debug information

### Web Dashboard Issues
- Verify Node.js server is running
- Check browser console for errors
- Ensure MQTT broker is accessible
- Confirm device ID matches ESP32 configuration

### Signal Quality Issues
- Check electrode placement
- Ensure good skin contact
- Verify lead connections
- Minimize electrical interference

## 📝 Technical Specifications

- **Sampling Rate**: 100 Hz (configurable)
- **ADC Resolution**: 12-bit (0-4095)
- **Heart Rate Range**: 40-200 BPM
- **Data Transmission**: MQTT over TLS/WSS
- **Web Technologies**: HTML5, CSS3, JavaScript, Chart.js

## 🔒 Security Notes

- MQTT connection uses TLS encryption
- SSL verification is disabled for testing (not recommended for production)
- Consider implementing proper certificate validation for production use

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

Feel free to submit issues, feature requests, and pull requests to improve this ECG monitoring system.

## ⚠️ Medical Disclaimer

This system is for educational and research purposes only. It is not intended for medical diagnosis or treatment. Always consult qualified healthcare professionals for medical advice.
