import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onBack: () => void;
}

export const InventoryScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.header}>FIELD BAG (CRUD)</Text>
        <View style={styles.grid}>
          <View style={styles.itemCard}><Text style={styles.itemText}>[ Cache #1 ]</Text></View>
          <View style={styles.itemCard}><Text style={styles.itemText}>[ Cache #2 ]</Text></View>
        </View>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>CACHE DETAILS</Text>
        <Text style={styles.subText}>Manage your planted & discovered items.</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 20 },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 20, borderLeftWidth: 3, borderColor: '#B08D57', justifyContent: 'space-between' },
  header: { color: '#2A2420', fontWeight: 'bold', fontSize: 16, marginBottom: 12 },
  grid: { flexDirection: 'row', gap: 10 },
  itemCard: { width: 100, height: 80, backgroundColor: '#F3ECD8', borderWidth: 1, borderColor: '#B08D57', justifyContent: 'center', alignItems: 'center', borderRadius: 4 },
  itemText: { color: '#2A2420', fontSize: 10, fontWeight: 'bold' },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 16 },
  subText: { color: '#B08D57', fontSize: 12 },
  backButton: { borderWidth: 1, borderColor: '#B08D57', padding: 10, borderRadius: 4, alignItems: 'center' },
  backText: { color: '#B08D57', fontWeight: 'bold' },
});