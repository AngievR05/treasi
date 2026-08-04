import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
          // Prevents hardware Dynamic Island / camera notch overlap in landscape
          { paddingLeft: insets.left, paddingRight: insets.right }
        ]}
      >
        {/* Left Operational Viewport (60% Width) */}
        <View 
          style={[styles.leftViewport, isLandscape ? styles.flexSixty : styles.flexFull]}
          accessibilityRole="summary"
        >
          {leftComponent}
        </View>

        {/* Brass Hardware Trim Divider */}
        {isLandscape && (
          <View 
            style={styles.brassDivider} 
            importantForAccessibility="no"
            aria-hidden={true}
          />
        )}

        {/* Right Command Console Panel (40% Width) */}
        <View 
          style={[styles.rightViewport, isLandscape ? styles.flexForty : styles.flexFull]}
          accessibilityRole="none"
        >
          <View style={[styles.innerConsoleContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
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
    backgroundColor: '#2C3B2E',
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
    backgroundColor: '#E8DCC0',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  rightViewport: {
    backgroundColor: '#2C3B2E',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  innerConsoleContainer: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'flex-start',
  },
  brassDivider: {
    width: 6,
    backgroundColor: '#B08D57',
    height: '100%',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#2A2420',
    opacity: 0.9,
  },
});