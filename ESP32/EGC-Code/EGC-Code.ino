#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// === WiFi Credentials ===
const char* ssid = "Maharshi";
const char* password = "MSD240604";

// === HiveMQ Cloud Credentials ===
const char* mqtt_server = "2a086fbdeb91453eacd25659758b74f3.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "maharshi";
const char* mqtt_pass = "Maharshi24";

const char* device_id = "ECG1";  // Hardcoded device ID

#define ECG_PIN 34
#define LO_PLUS 32
#define LO_MINUS 33

unsigned long lastSendTime = 0;
const int sendInterval = 10;  // 100Hz

WiFiClientSecure secureClient;
PubSubClient client(secureClient);

// Skip SSL verification for testing
void configureClientSSL() {
  secureClient.setInsecure();  // Not secure in production
}

// Connect to WiFi
void setup_wifi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
}

// MQTT Connection
void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");

    String will_topic = "iot/devices/" + String(device_id) + "/status";
    if (client.connect(device_id, mqtt_user, mqtt_pass,
                       will_topic.c_str(), 0, true, "offline")) {
      Serial.println("connected");

      // Publish online status
      client.publish(will_topic.c_str(), "online", true);
    } else {
      Serial.print("failed, rc=");
      Serial.println(client.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LO_PLUS, INPUT_PULLUP);
  pinMode(LO_MINUS, INPUT_PULLUP);
  setup_wifi();
  configureClientSSL();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
    return; // Skip the rest of the loop if reconnecting
  }
  
  client.loop();

  unsigned long currentMillis = millis();
  if (currentMillis - lastSendTime >= sendInterval) {
    lastSendTime = currentMillis;

    // Check for lead-off condition
    if (digitalRead(LO_PLUS) == HIGH || digitalRead(LO_MINUS) == HIGH) {
      String statusTopic = "iot/devices/" + String(device_id) + "/status";
      client.publish(statusTopic.c_str(), "Leads Off!");
      return;
    }

    // Read ECG value (0-4095 for ESP32 ADC)
    int ecg_value = analogRead(ECG_PIN);
    unsigned long timestamp = millis();

    // Create JSON payload
    String payload = "{";
    payload += "\"device_id\":\"" + String(device_id) + "\",";
    payload += "\"timestamp\":" + String(timestamp) + ",";
    payload += "\"ecg_value\":" + String(ecg_value);
    payload += "}";

    String topic = "iot/devices/" + String(device_id);
    
    // Publish the data
    bool published = client.publish(topic.c_str(), payload.c_str());
    
    // Debug output
    if (published) {
      Serial.print("Published to ");
      Serial.print(topic);
      Serial.print(": ");
      Serial.println(payload);
    } else {
      Serial.println("Publish failed!");
    }
  }
}
