import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onComplete: () => void;
}

const STEPS = [
  { step: '01 / 03', title: 'ALIGN INSTRUMENT', desc: 'Lock device horizontally into landscape orientation to calibrate analogue dials.' },
  { step: '02 / 03', title: 'TRACK TARGETS', desc: 'Follow continuous live heading and GPS telemetry to navigate towards hidden field caches.' },
  { step: '03 / 03', title: 'EXCAVATE REWARDS', desc: 'Apply physical kinetic shaking motion when within 5 meters of target coordinates to reveal payloads.' }
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const [index, setIndex] = useState(0);

  const handleNext = () => {
    if (index < STEPS.length - 1) setIndex(index + 1);
    else onComplete();
  };

  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.stepBadge}>{STEPS[index].step}</Text>
        <Text style={styles.title}>{STEPS[index].title}</Text>
        <Text style={styles.desc}>{STEPS[index].desc}</Text>
      </View>
      <View style={styles.rightViewport}>
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.buttonText}>
            {index === STEPS.length - 1 ? 'ENTER FIELD ›' : 'NEXT PROTOCOL ›'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 24, justifyContent: 'center' },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 24, justifyContent: 'center', borderLeftWidth: 3, borderColor: '#B08D57' },
  stepBadge: { color: '#A64B2A', fontWeight: 'bold', fontSize: 12, marginBottom: 8 },
  title: { color: '#2A2420', fontSize: 24, fontWeight: 'bold', letterSpacing: 2, marginBottom: 12 },
  desc: { color: '#2A2420', fontSize: 14, lineHeight: 20 },
  nextButton: { backgroundColor: '#A64B2A', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 4, alignItems: 'center' },
  buttonText: { color: '#E8DCC0', fontWeight: 'bold', letterSpacing: 2 },
});