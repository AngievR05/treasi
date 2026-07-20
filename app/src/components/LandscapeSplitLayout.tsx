import React from 'react';
import { StyleSheet, View, useWindowDimensions, SafeAreaView } from 'react-native';

interface LandscapeSplitLayoutProps {
  leftComponent: React.ReactNode;
  rightComponent: React.ReactNode;
}

export const LandscapeSplitLayout: React.FC<LandscapeSplitLayoutProps> = ({
  leftComponent,
  rightComponent,
}) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <SafeAreaView style={styles.outerContainer}>
      <View style={[styles.wrapper, { flexDirection: isLandscape ? 'row' : 'column' }]}>
        
        {/* Left Operational Viewport (60% Width in Landscape) */}
        <View style={[styles.leftViewport, isLandscape ? { flex: 0.60 } : { flex: 1 }]}>
          {leftComponent}
        </View>

        {/* Decorative Structural Border Pin (Asymmetric Brass Trim Divider) */}
        {isLandscape && <View style={styles.brassDivider} />}

        {/* Right Control Console Panel (40% Width in Landscape) */}
        <View style={[styles.rightViewport, isLandscape ? { flex: 0.40 } : { flex: 1 }]}>
          {rightComponent}
        </View>

      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Thematic Grounding Color: Forest Deep
  },
  wrapper: {
    flex: 1,
  },
  leftViewport: {
    backgroundColor: '#E8DCC0', // Thematic Background: Parchment Base
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightViewport: {
    backgroundColor: '#2C3B2E', // Forest Deep chassis frame
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: 16,
  },
  brassDivider: {
    width: 4,
    backgroundColor: '#B08D57', // Style Token Accent: Brass Trim
    height: '100%',
    opacity: 0.8,
  },
});