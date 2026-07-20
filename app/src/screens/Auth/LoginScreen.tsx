import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  useWindowDimensions 
} from 'react-native';

export default function LoginScreen() {
  const { width, height } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Enforce structural boundaries for landscape viewports dynamically
  const isLandscape = width > height;

  return (
    <View style={[styles.container, { flexDirection: isLandscape ? 'row' : 'column' }]}>
      
      {/* Left Viewport (60% Width): Thematic Branding Instrument Space */}
      <View style={styles.leftOperationalViewport}>
        <Text style={styles.vintageTitle}>TREASI</Text>
        <Text style={styles.tagline}>Hide. Explore. Stay connected.</Text>
        <View style={styles.radarPlaceholderBlock}>
          {/* Micro-interaction badge or vector illustration will live here */}
          <Text style={styles.sensorStatusText}>[ HARDWARE RADAR CHASSIS READY ]</Text>
        </View>
      </View>

      {/* Right Viewport (40% Width): Control Console Input Panel */}
      <View style={styles.rightControlPanel}>
        <Text style={styles.consoleHeader}>EXPLORER ACCESS</Text>
        
        <TextInput
          style={styles.vintageInput}
          placeholder="ENTER INSTITUTIONAL EMAIL"
          placeholderTextColor="#A64B2A"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={styles.vintageInput}
          placeholder="ENTER PASS-KEY"
          placeholderTextColor="#A64B2A"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
        />

        <TouchableOpacity 
          style={styles.stampedButton}
          activeOpacity={0.8}
          onPress={() => console.log('Auth logic executing...')}
        >
          <Text style={styles.buttonText}>SEAL & ENTER</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

// Strictly enforcing Design System Color Tokens from Spec Document
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep Dark Chassis
  },
  leftOperationalViewport: {
    flex: 0.60, // Exact brief allocation matrix
    backgroundColor: '#E8DCC0', // Parchment Base Texture
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  rightControlPanel: {
    flex: 0.40, // Technical telemetry control node
    backgroundColor: '#2C3B2E', 
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#B08D57', // Brass Trim Framing
  },
  vintageTitle: {
    fontSize: 36,
    fontFamily: 'Courier New', // Fallback for Courier Prime style token
    fontWeight: 'bold',
    color: '#2A2420', // Ink Black
    letterSpacing: 6,
  },
  tagline: {
    fontSize: 14,
    fontFamily: 'Georgia', // Fallback for Old Standard TT serif style token
    color: '#2A2420',
    fontStyle: 'italic',
    marginTop: 4,
  },
  radarPlaceholderBlock: {
    marginTop: 30,
    padding: 16,
    borderWidth: 2,
    borderColor: '#B08D57',
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  sensorStatusText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#A64B2A', // Sienna Accent
  },
  consoleHeader: {
    fontFamily: 'Courier New',
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E8DCC0',
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 2,
  },
  vintageInput: {
    backgroundColor: '#F3ECD8', // Secondary Parchment Contrast
    fontFamily: 'Courier New',
    fontSize: 13,
    color: '#2A2420',
    padding: 12,
    borderRadius: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  stampedButton: {
    backgroundColor: '#A64B2A', // Sienna Call-to-Action stamp color
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 2,
    borderColor: '#B08D57',
    // Thumb zone touch ergonomics compliance (>= 48dp)
    minHeight: 48, 
  },
  buttonText: {
    fontFamily: 'Courier New',
    fontWeight: 'bold',
    color: '#E8DCC0',
    letterSpacing: 2,
  },
});