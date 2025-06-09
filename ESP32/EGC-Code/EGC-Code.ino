#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// === WiFi Credentials ===
const char* ssid = "Maharshi";
const char* password = "MSD240604";

// === HiveMQ Cloud Credentials ===
const char* mqtt_server = "2a086fbdeb91453eacd25659758b74f3.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "maharshi";
const char* mqtt_pass = "Maharshi24";

const char* device_id = "ECG1";  // Device ID

// Pin definitions
#define ECG_PIN 34
#define LO_PLUS 32
#define LO_MINUS 33
#define LED_PIN 2  // Built-in LED for status indication

// Timing variables
unsigned long lastSendTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastReconnectAttempt = 0;
const int sendInterval = 10;  // 100Hz sampling rate
const int heartbeatInterval = 30000;  // 30 seconds
const int reconnectInterval = 5000;   // 5 seconds

// Connection tracking
bool wifiConnected = false;
bool mqttConnected = false;
int reconnectAttempts = 0;
const int maxReconnectAttempts = 5;

// Data quality tracking
int validReadings = 0;
int totalReadings = 0;
bool leadsOff = false;

WiFiClientSecure secureClient;
PubSubClient client(secureClient);

// Configure SSL client
void configureClientSSL() {
  secureClient.setInsecure();  // Skip SSL verification for testing
}

// Connect to WiFi with retry logic
void setup_wifi() {
  Serial.println("Starting WiFi connection...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;

    // Blink LED during connection
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    digitalWrite(LED_PIN, HIGH);  // LED on when connected
    Serial.println("\nWiFi connected successfully!");
    Serial.println("IP address: " + WiFi.localIP().toString());
    Serial.println("Signal strength: " + String(WiFi.RSSI()) + " dBm");
  } else {
    wifiConnected = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("\nWiFi connection failed!");
  }
}

// Check WiFi connection and reconnect if needed
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      Serial.println("WiFi connection lost. Attempting to reconnect...");
      wifiConnected = false;
      mqttConnected = false;
    }

    if (millis() - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = millis();
      setup_wifi();
    }
  }
}

// MQTT Connection with improved error handling
void connectMQTT() {
  if (!wifiConnected) return;

  if (reconnectAttempts >= maxReconnectAttempts) {
    Serial.println("Max MQTT reconnect attempts reached. Restarting WiFi...");
    reconnectAttempts = 0;
    wifiConnected = false;
    WiFi.disconnect();
    delay(1000);
    setup_wifi();
    return;
  }

  Serial.print("Connecting to MQTT broker... Attempt ");
  Serial.println(reconnectAttempts + 1);

  String will_topic = "iot/devices/" + String(device_id) + "/status";
  String client_id = String(device_id) + "_" + String(random(0xffff), HEX);

  if (client.connect(client_id.c_str(), mqtt_user, mqtt_pass,
                     will_topic.c_str(), 0, true, "offline")) {
    Serial.println("MQTT connected successfully!");
    mqttConnected = true;
    reconnectAttempts = 0;

    // Publish online status with device info
    StaticJsonDocument<200> statusDoc;
    statusDoc["status"] = "online";
    statusDoc["device_id"] = device_id;
    statusDoc["ip"] = WiFi.localIP().toString();
    statusDoc["rssi"] = WiFi.RSSI();
    statusDoc["timestamp"] = millis();

    String statusPayload;
    serializeJson(statusDoc, statusPayload);
    client.publish(will_topic.c_str(), statusPayload.c_str(), true);

    // Publish device capabilities
    String capTopic = "iot/devices/" + String(device_id) + "/capabilities";
    StaticJsonDocument<300> capDoc;
    capDoc["sampling_rate"] = 1000 / sendInterval;
    capDoc["adc_resolution"] = 12;
    capDoc["max_value"] = 4095;
    capDoc["lead_detection"] = true;

    String capPayload;
    serializeJson(capDoc, capPayload);
    client.publish(capTopic.c_str(), capPayload.c_str(), true);

  } else {
    Serial.print("MQTT connection failed, rc=");
    Serial.println(client.state());
    reconnectAttempts++;
    mqttConnected = false;
  }
}

// Send heartbeat to indicate device is alive
void sendHeartbeat() {
  if (!mqttConnected) return;

  String heartbeatTopic = "iot/devices/" + String(device_id) + "/heartbeat";
  StaticJsonDocument<150> heartbeatDoc;
  heartbeatDoc["timestamp"] = millis();
  heartbeatDoc["uptime"] = millis() / 1000;
  heartbeatDoc["free_heap"] = ESP.getFreeHeap();
  heartbeatDoc["wifi_rssi"] = WiFi.RSSI();

  String heartbeatPayload;
  serializeJson(heartbeatDoc, heartbeatPayload);
  client.publish(heartbeatTopic.c_str(), heartbeatPayload.c_str());
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ECG Monitor Starting ===");

  // Initialize pins
  pinMode(LO_PLUS, INPUT_PULLUP);
  pinMode(LO_MINUS, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Initialize random seed
  randomSeed(analogRead(0));

  // Setup connections
  setup_wifi();
  configureClientSSL();
  client.setServer(mqtt_server, mqtt_port);

  // Initial connection attempt
  if (wifiConnected) {
    connectMQTT();
  }

  Serial.println("=== Setup Complete ===");
  Serial.println("Device ID: " + String(device_id));
  Serial.println("Sampling Rate: " + String(1000/sendInterval) + " Hz");
}

void loop() {
  unsigned long currentMillis = millis();

  // Check WiFi connection
  checkWiFiConnection();

  // Handle MQTT connection
  if (wifiConnected && !client.connected()) {
    if (currentMillis - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = currentMillis;
      connectMQTT();
    }
  }

  // Process MQTT messages
  if (client.connected()) {
    client.loop();
  }

  // Send ECG data at specified interval
  if (currentMillis - lastSendTime >= sendInterval) {
    lastSendTime = currentMillis;
    totalReadings++;

    // Check for lead-off condition
    bool currentLeadsOff = (digitalRead(LO_PLUS) == HIGH || digitalRead(LO_MINUS) == HIGH);

    if (currentLeadsOff != leadsOff) {
      leadsOff = currentLeadsOff;
      String statusTopic = "iot/devices/" + String(device_id) + "/status";

      if (leadsOff) {
        client.publish(statusTopic.c_str(), "Leads Off - Check electrode connections!", true);
        Serial.println("WARNING: Leads disconnected!");
      } else {
        client.publish(statusTopic.c_str(), "Leads connected - Signal restored", true);
        Serial.println("INFO: Leads reconnected");
      }
    }

    if (!leadsOff) {
      // Read ECG value (0-4095 for ESP32 12-bit ADC)
      int ecg_value = analogRead(ECG_PIN);
      validReadings++;

      // Create enhanced JSON payload
      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["timestamp"] = currentMillis;
      doc["ecg_value"] = ecg_value;
      doc["sequence"] = totalReadings;
      doc["signal_quality"] = (validReadings * 100) / totalReadings;

      String payload;
      serializeJson(doc, payload);

      String topic = "iot/devices/" + String(device_id);

      // Publish the data
      if (mqttConnected && client.publish(topic.c_str(), payload.c_str())) {
        // Blink LED to indicate successful transmission
        digitalWrite(LED_PIN, LOW);
        delay(1);
        digitalWrite(LED_PIN, HIGH);

        // Reduced debug output for performance
        if (totalReadings % 100 == 0) {  // Print every 100 readings
          Serial.println("Readings sent: " + String(totalReadings) +
                        ", Quality: " + String((validReadings * 100) / totalReadings) + "%");
        }
      } else {
        Serial.println("Publish failed! MQTT connected: " + String(mqttConnected));
      }
    }
  }

  // Send periodic heartbeat
  if (currentMillis - lastHeartbeat >= heartbeatInterval) {
    lastHeartbeat = currentMillis;
    sendHeartbeat();
  }

  // Small delay to prevent watchdog issues
  delay(1);
}
