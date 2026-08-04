// src/components/LandscapeSplitLayout.tsx
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

interface LandscapeSplitLayoutProps {
  leftComponent: React.ReactNode;
  rightComponent: React.ReactNode;
}

/**
 * LandscapeSplitLayout
 * Enforces the rigid 60/40 split dashboard system for the Treasi Field Console.
 * Left Viewport (60%): Dedicated to high-frequency analogue sensors/maps.
 * Right Panel (40%): Thumb-optimized mechanical command controls.
 */
export const LandscapeSplitLayout: React.FC<LandscapeSplitLayoutProps> = ({
  leftComponent,
  rightComponent,
}) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

  const dynamicDirection = isLandscape ? 'row' : 'column';

  return (
    <SafeAreaView 
      style={styles.outerContainer} 
      edges={['top', 'bottom', 'left', 'right']}
    >
      <View 
        style={[
          styles.wrapper, 
          { flexDirection: dynamicDirection },
          // Applies safe horizontal padding to prevent Dynamic Island/notch overlap
          { paddingLeft: insets.left, paddingRight: insets.right }
        ]}
      >
        
        {/* Left Operational Viewport (60% Width) - Houses Map Canvas / Radar Instrument */}
        <View 
          style={[styles.leftViewport, isLandscape ? styles.flexSixty : styles.flexFull]}
          accessibilityRole="summary"
        >
          {leftComponent}
        </View>

        {/* Decorative Structural Border Pin (Asymmetric Brass Trim Divider) */}
        {isLandscape && (
          <View 
            style={styles.brassDivider} 
            importantForAccessibility="no"
            aria-hidden={true}
          />
        )}

        {/* Right Control Console Panel (40% Width) - Ergonomic Target Zone */}
        <View 
          style={[styles.rightViewport, isLandscape ? styles.flexForty : styles.flexFull]}
          accessibilityRole="none"
        >
          <View style={styles.innerConsoleContainer}>
            {rightComponent}
          </View>
        </View>

      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep
  },
  wrapper: {
    flex: 1,
  },
  flexSixty: {
    flex: 0.60,
  },
  flexForty: {
    flex: 0.40,
  },
  flexFull: {
    flex: 1,
  },
  leftViewport: {
    backgroundColor: '#E8DCC0', // Parchment Base
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  rightViewport: {
    backgroundColor: '#2C3B2E', // Forest Deep chassis frame
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  innerConsoleContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'space-between',
  },
  brassDivider: {
    width: 6,
    backgroundColor: '#B08D57', // Brass Trim
    height: '100%',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#2A2420', // Ink Black
    opacity: 0.9,
  },
});