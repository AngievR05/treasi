import React, {
  memo,
  useCallback,
} from 'react';

import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Ionicons,
} from '@expo/vector-icons';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type NavigationTab =
  | 'MAP'
  | 'HUNT'
  | 'LEADERBOARD'
  | 'INVENTORY'
  | 'PROFILE';

export interface FieldNavBarProps {
  currentTab: NavigationTab;

  onNavigate?: (
    screen: string,
  ) => void;
}

interface NavItem {
  key: NavigationTab;

  label: string;

  accessibilityLabel: string;

  accessibilityHint: string;

  activeIcon:
    keyof typeof Ionicons.glyphMap;

  inactiveIcon:
    keyof typeof Ionicons.glyphMap;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const COLOURS = {
  forest950: '#172018',
  forest900: '#1C261D',
  forest800: '#2C3B2E',
  forest700: '#3D503F',

  parchment100: '#F6EFD9',
  parchment200: '#E8DCC0',

  bronze700: '#5F4B32',
  bronze600: '#6B563A',
  bronze500: '#B08D57',
  bronze400: '#C3A06A',

  rust800: '#71301C',
  rust700: '#7F321B',
  rust600: '#8C3A20',
} as const;

const MONO_BOLD_FONT =
  Platform.OS === 'ios'
    ? 'Courier-Bold'
    : 'monospace';

const NAV_ITEMS:
  readonly NavItem[] = [
  {
    key: 'MAP',

    label: 'MAP',

    accessibilityLabel:
      'Field map',

    accessibilityHint:
      'Opens the Treasi field map and Dashboard.',

    activeIcon:
      'map',

    inactiveIcon:
      'map-outline',
  },

  {
    key: 'HUNT',

    label: 'HUNT',

    accessibilityLabel:
      'Hunt',

    accessibilityHint:
      'Opens Hunt mode for the currently selected treasure. A treasure must be selected first.',

    activeIcon:
      'compass',

    inactiveIcon:
      'compass-outline',
  },

  {
    key: 'LEADERBOARD',

    label: 'RANKS',

    accessibilityLabel:
      'Explorer leaderboard',

    accessibilityHint:
      'Opens the Explorer rankings and community area.',

    activeIcon:
      'trophy',

    inactiveIcon:
      'trophy-outline',
  },

  {
    key: 'INVENTORY',

    label: 'BAG',

    accessibilityLabel:
      'Field cache inventory',

    accessibilityHint:
      'Opens your nearby cache inventory and cache creation tools.',

    activeIcon:
      'briefcase',

    inactiveIcon:
      'briefcase-outline',
  },

  {
    key: 'PROFILE',

    label: 'PROFILE',

    accessibilityLabel:
      'Profile and settings',

    accessibilityHint:
      'Opens your Explorer profile, preferences and account controls.',

    activeIcon:
      'person',

    inactiveIcon:
      'person-outline',
  },
];

/* -------------------------------------------------------------------------- */
/* Navigation item                                                            */
/* -------------------------------------------------------------------------- */

interface FieldNavItemProps {
  item: NavItem;

  isActive: boolean;

  navigationAvailable: boolean;

  onNavigate: (
    tab: NavigationTab,
  ) => void;
}

const FieldNavItem:
  React.FC<
    FieldNavItemProps
  > = ({
    item,
    isActive,
    navigationAvailable,
    onNavigate,
  }) => {
    const handlePress =
      useCallback(
        (): void => {
          /*
           * Avoid unnecessary screen transitions when the Explorer
           * presses the tab that is already active.
           */
          if (
            isActive ||
            !navigationAvailable
          ) {
            return;
          }

          onNavigate(
            item.key,
          );
        },
        [
          isActive,
          item.key,
          navigationAvailable,
          onNavigate,
        ],
      );

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          item.accessibilityLabel
        }
        accessibilityHint={
          isActive
            ? `${item.accessibilityLabel} is the current section.`
            : item.accessibilityHint
        }
        accessibilityState={{
          selected:
            isActive,

          disabled:
            !navigationAvailable,
        }}
        disabled={
          !navigationAvailable
        }
        hitSlop={2}
        onPress={
          handlePress
        }
        testID={`field-nav-${item.key.toLowerCase()}`}
        style={({
          pressed,
        }) => [
          styles.navButton,

          isActive &&
            styles.navButtonActive,

          !navigationAvailable &&
            styles.navButtonDisabled,

          pressed &&
            !isActive &&
            navigationAvailable &&
            styles.navButtonPressed,
        ]}
      >
        {/* Active rail reinforces selection without relying on colour alone. */}
        <View
          accessible={
            false
          }
          importantForAccessibility="no"
          style={[
            styles.activeRail,

            isActive &&
              styles.activeRailVisible,
          ]}
        />

        <Ionicons
          accessible={
            false
          }
          importantForAccessibility="no"
          name={
            isActive
              ? item.activeIcon
              : item.inactiveIcon
          }
          size={19}
          color={
            isActive
              ? COLOURS.parchment100
              : COLOURS.bronze400
          }
        />

        <Text
          accessible={
            false
          }
          importantForAccessibility="no"
          maxFontSizeMultiplier={
            1.4
          }
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={[
            styles.navLabel,

            isActive &&
              styles.navLabelActive,
          ]}
        >
          {item.label}
        </Text>

        {isActive ? (
          <View
            accessible={
              false
            }
            importantForAccessibility="no"
            style={
              styles.activeDot
            }
          />
        ) : (
          <View
            accessible={
              false
            }
            importantForAccessibility="no"
            style={
              styles.inactiveDotPlaceholder
            }
          />
        )}
      </Pressable>
    );
  };

/* -------------------------------------------------------------------------- */
/* Field navigation bar                                                       */
/* -------------------------------------------------------------------------- */

const FieldNavBarComponent:
  React.FC<
    FieldNavBarProps
  > = ({
    currentTab,
    onNavigate,
  }) => {
    const navigationAvailable =
      typeof onNavigate ===
      'function';

    const handleNavigate =
      useCallback(
        (
          tab:
            NavigationTab,
        ): void => {
          if (
            !onNavigate
          ) {
            return;
          }

          onNavigate(
            tab,
          );
        },
        [
          onNavigate,
        ],
      );

    return (
      <View
        accessible={
          false
        }
        style={
          styles.wrapper
        }
      >
        <View
          accessible={
            false
          }
          importantForAccessibility="no"
          style={
            styles.instrumentRail
          }
        />

        <View
          accessibilityLabel="Treasi primary navigation"
          style={
            styles.navBarContainer
          }
        >
          {NAV_ITEMS.map(
            (
              item,
            ) => (
              <FieldNavItem
                key={
                  item.key
                }
                item={
                  item
                }
                isActive={
                  currentTab ===
                  item.key
                }
                navigationAvailable={
                  navigationAvailable
                }
                onNavigate={
                  handleNavigate
                }
              />
            ),
          )}
        </View>
      </View>
    );
  };

/*
 * The navigation bar only needs to rerender when its active tab
 * or navigation callback changes.
 */
export const FieldNavBar =
  memo(
    FieldNavBarComponent,
  );

FieldNavBar.displayName =
  'FieldNavBar';

export default FieldNavBar;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    wrapper: {
      position: 'relative',
      width: '100%',
      flexShrink: 0,
    },

    instrumentRail: {
      position: 'absolute',
      top: 0,
      left: 14,
      right: 14,
      height: 1,
      backgroundColor:
        COLOURS.bronze500,
      opacity: 0.55,
      zIndex: 1,
    },

    navBarContainer: {
      width: '100%',
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent:
        'space-between',
      paddingHorizontal: 4,
      paddingTop: 5,
      paddingBottom: 4,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 6,
      overflow: 'hidden',
    },

    navButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 56,
      position: 'relative',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 2,
      paddingHorizontal: 2,
      paddingTop: 6,
      paddingBottom: 4,
      marginHorizontal: 1,
      borderRadius: 4,
      borderWidth: 1,
      borderColor:
        'transparent',
    },

    navButtonActive: {
      backgroundColor:
        COLOURS.rust700,
      borderColor:
        COLOURS.rust800,
    },

    navButtonPressed: {
      backgroundColor:
        COLOURS.forest700,
      borderColor:
        COLOURS.bronze600,
      opacity: 0.85,
    },

    navButtonDisabled: {
      opacity: 0.48,
    },

    activeRail: {
      position: 'absolute',
      top: 0,
      left: 10,
      right: 10,
      height: 3,
      borderRadius: 2,
      backgroundColor:
        'transparent',
    },

    activeRailVisible: {
      backgroundColor:
        COLOURS.parchment100,
    },

    navLabel: {
      width: '100%',
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.45,
      textAlign: 'center',
    },

    navLabelActive: {
      color:
        COLOURS.parchment100,
    },

    activeDot: {
      width: 4,
      height: 4,
      marginTop: 1,
      borderRadius: 2,
      backgroundColor:
        COLOURS.parchment100,
    },

    inactiveDotPlaceholder: {
      width: 4,
      height: 4,
      marginTop: 1,
    },
  });