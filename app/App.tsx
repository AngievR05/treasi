import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

export default function App() {
  const { width, height } = useWindowDimensions();
  
  // Enforce a quick programmatic check for landscape layout safety
  const isLandscape = width > height;

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden />
      
      {isLandscape ? (
        <View style={styles.splitWrapper}>
          {/* Left Operational Viewport - 60% Scale */}
          {/* This will eventually house your Custom Styled Map and Radar/Compass Dials */}
          <View style={styles.leftViewport}>
            <Text style={styles.headingText}>TREASI</Text>
            <Text style={styles.bodyText}>Hide. Explore. Stay connected.</Text>
            <Text style={styles.telemetryText}>[ Operational Viewport - 60% ]</Text>
          </View>

          {/* Right Control Panel - 40% Scale */}
          {/* This will house your Telemetry readouts, Field Bag CRUD mechanics, and Stamp CTAs */}
          <View style={styles.rightViewport}>
            <Text style={styles.panelTitleText}>CONTROL CONSOLE</Text>
            <View style={styles.rivetPlaceholder} />
            <Text style={styles.consoleTelemetryText}>[ Tactical Panel - 40% ]</Text>
          </View>
        </View>
      ) : (
        /* Accessibility safety net for incorrect orientations during development testing */
        <View style={styles.orientationWarning}>
          <Text style={styles.warningText}>Tilt Instrument Horizontally</Text>
          <Text style={styles.warningSubText}>Treasi requires landscape alignment to calibrate sensors.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep
  },
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
  },
  leftViewport: {
    flex: 0.60,
    backgroundColor: '#E8DCC0', // Parchment
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  rightViewport: {
    flex: 0.40,
    backgroundColor: '#2C3B2E', // Forest Deep
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderLeftWidth: 3,
    borderColor: '#B08D57', // Brass Trim
  },
  headingText: {
    color: '#2A2420', // Ink Black
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 4,
    marginBottom: 4,
  },
  bodyText: {
    color: '#2A2420', // Ink Black
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 20,
  },
  telemetryText: {
    color: '#A64B2A', // Sienna Accent preview
    fontSize: 11,
    fontWeight: '600',
  },
  panelTitleText: {
    color: '#E8DCC0', // Parchment
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 12,
  },
  consoleTelemetryText: {
    color: '#B08D57', // Brass Trim
    fontSize: 11,
  },
  rivetPlaceholder: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B08D57', // Brass Trim Rivet
    marginVertical: 10,
  },
  orientationWarning: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2C3B2E',
    padding: 32,
  },
  warningText: {
    color: '#E8DCC0',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  warningSubText: {
    color: '#B08D57',
    fontSize: 12,
    textAlign: 'center',
  },
});