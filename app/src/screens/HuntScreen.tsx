import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onBack: () => void;
}

export const HuntScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <View style={styles.compassDial}>
          <Text style={styles.compassHeading}>N</Text>
          <Text style={styles.distanceText}>045 m</Text>
          <Text style={styles.distanceSub}>TO TARGET</Text>
        </View>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>ACTIVE HINT</Text>
        <Text style={styles.hintBox}>"Where the old oak splits the fence, ten steps toward the setting sun..."</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>‹ RETURN TO BASE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#1A241B', justifyContent: 'center', alignItems: 'center' },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 16, borderLeftWidth: 3, borderColor: '#B08D57', justifyContent: 'space-between' },
  compassDial: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: '#B08D57', justifyContent: 'center', alignItems: 'center', backgroundColor: '#2C3B2E' },
  compassHeading: { color: '#A64B2A', fontWeight: 'bold', fontSize: 18 },
  distanceText: { color: '#E8DCC0', fontSize: 20, fontWeight: 'bold', marginTop: 4 },
  distanceSub: { color: '#B08D57', fontSize: 8, letterSpacing: 1 },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 14 },
  hintBox: { color: '#E8DCC0', fontStyle: 'italic', backgroundColor: '#1A241B', padding: 12, borderRadius: 4, fontSize: 12, lineHeight: 18 },
  backButton: { borderWidth: 1, borderColor: '#B08D57', padding: 10, borderRadius: 4, alignItems: 'center' },
  backText: { color: '#B08D57', fontWeight: 'bold', fontSize: 10 },
});