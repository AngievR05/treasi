import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onBack: () => void;
}

export const LeaderboardScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.header}>FIELD MANIFEST</Text>
        <Text style={styles.row}>01  WILDER_WREN .................... 4,260 PTS</Text>
        <Text style={styles.row}>02  SILENT_ELK ...................... 4,100 PTS</Text>
        <Text style={styles.rowHighlight}>03  YOU (AGENT_71) .................. 2,340 PTS</Text>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>TOWN CRIER</Text>
        <Text style={styles.subText}>Global & Local Explorer Ranks</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 20, justifyContent: 'center' },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 20, borderLeftWidth: 3, borderColor: '#B08D57', justifyContent: 'space-between' },
  header: { color: '#2A2420', fontWeight: 'bold', fontSize: 18, marginBottom: 16, letterSpacing: 2 },
  row: { color: '#2A2420', fontFamily: 'Courier', fontSize: 12, marginBottom: 8 },
  rowHighlight: { color: '#A64B2A', fontFamily: 'Courier', fontWeight: 'bold', fontSize: 12, marginBottom: 8 },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 16 },
  subText: { color: '#B08D57', fontSize: 12 },
  backButton: { borderWidth: 1, borderColor: '#B08D57', padding: 10, borderRadius: 4, alignItems: 'center' },
  backText: { color: '#B08D57', fontWeight: 'bold' },
});