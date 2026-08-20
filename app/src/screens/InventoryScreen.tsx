import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Archive,
  BookOpen,
  ChevronLeft,
  Compass,
  Edit3,
  FileSearch,
  MapPin,
  Navigation,
  Package,
  Plus,
  Radio,
  ShieldAlert,
  Target,
  Trash2,
  Trophy,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import {
  collection,
  doc,
  GeoPoint,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { TreasureDocument } from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

export type IconType = 'map-pin' | 'target' | 'compass' | 'trophy' | 'book';

export interface DisplayItem {
  id: string;
  dbRef: string;
  title: string;
  category: 'cache';
  iconType: IconType;
  coordinates: string;
  rawLat: number;
  rawLng: number;
  distanceKm: number;
  status: string;
  hint?: string;
  payloadText?: string;
  creatorId: string;
  creatorName?: string;
  createdAt?: unknown;
}

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

interface InventoryScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string, params?: NavigationParams) => void;
  initialParams?: NavigationParams;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

const INVENTORY_RADIUS_KM = 20;
const MIN_TITLE_LENGTH = 3;
const LOCATION_UPDATE_INTERVAL_MS = 10_000;
const LOCATION_UPDATE_DISTANCE_M = 10;
const MIN_TOUCH_TARGET = 48;
const FIRESTORE_SAFE_BATCH_SIZE = 450;

const COLORS = {
  forest: '#2C3B2E',
  forestDark: '#1C2A20',
  parchment: '#E8DCC0',
  parchmentLight: '#F3ECD8',
  sienna: '#8B3E24',
  brass: '#B08D57',
  brassLight: '#E2C792',
  ink: '#2A2420',
  inkMuted: '#5F5748',
  white: '#FFFFFF',
};

const announce = (message: string): void => {
  AccessibilityInfo.announceForAccessibility(message);
};

const isValidCoordinate = (latitude: number, longitude: number): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

const calculateHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const parseCoordinate = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const getSafeCreatorName = (name?: string): string => {
  const trimmed = name?.trim();
  return trimmed || 'EXPLORER';
};

const getFriendlyFirestoreError = (error: unknown, fallback: string): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  if (code.includes('permission-denied')) {
    return 'You do not have permission to perform this field operation.';
  }
  if (code.includes('unavailable') || code.includes('network')) {
    return 'The field network is unavailable. Check your connection and try again.';
  }
  return fallback;
};

const ItemIcon: React.FC<{ type: IconType; size?: number; stroke?: string }> = ({
  type,
  size = 22,
  stroke = COLORS.sienna,
}) => {
  const commonProps = { size, stroke, strokeWidth: 2.1 };

  switch (type) {
    case 'map-pin':
      return <MapPin {...commonProps} />;
    case 'target':
      return <Target {...commonProps} />;
    case 'compass':
      return <Compass {...commonProps} />;
    case 'trophy':
      return <Trophy {...commonProps} />;
    case 'book':
      return <BookOpen {...commonProps} />;
    default:
      return <Package {...commonProps} />;
  }
};

interface AnimatedTouchableOpacityProps {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  disabled?: boolean;
  selected?: boolean;
  reduceMotion?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

const AnimatedTouchableOpacity: React.FC<AnimatedTouchableOpacityProps> = ({
  onPress,
  style,
  children,
  disabled = false,
  selected = false,
  reduceMotion = false,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = reduceMotion ? 1 : withSpring(0.97, { damping: 16, stiffness: 220 });
  };

  const handlePressOut = () => {
    scale.value = reduceMotion ? 1 : withSpring(1, { damping: 16, stiffness: 220 });
  };

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={4}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  onNavigate,
  initialParams,
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotionEnabled(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const initialCoordinates: Coordinates | null =
    isValidCoordinate(
      initialParams?.latitude ?? Number.NaN,
      initialParams?.longitude ?? Number.NaN
    )
      ? {
          latitude: initialParams!.latitude!,
          longitude: initialParams!.longitude!,
        }
      : null;

  const [activeScreen, setActiveScreen] = useState<NavigationTab>('INVENTORY');
  const [userCoords, setUserCoords] = useState<Coordinates | null>(initialCoordinates);
  const [firestoreTreasures, setFirestoreTreasures] = useState<
    Array<{ id: string; data: TreasureDocument }>
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBurying, setIsBurying] = useState(initialParams?.mode === 'create');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [newTitle, setNewTitle] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newPayload, setNewPayload] = useState('');
  const [newLat, setNewLat] = useState(
    initialCoordinates ? initialCoordinates.latitude.toFixed(6) : ''
  );
  const [newLng, setNewLng] = useState(
    initialCoordinates ? initialCoordinates.longitude.toFixed(6) : ''
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHint, setEditHint] = useState('');
  const [editPayload, setEditPayload] = useState('');

  const coordinateInputsTouchedRef = useRef(Boolean(initialCoordinates));
  const currentUserId = auth.currentUser?.uid ?? null;

  useEffect(() => {
    if (initialParams?.mode !== 'create') return;

    setIsBurying(true);
    setFieldErrors({});

    const hasCoordinates = isValidCoordinate(
      initialParams.latitude ?? Number.NaN,
      initialParams.longitude ?? Number.NaN
    );

    if (hasCoordinates) {
      coordinateInputsTouchedRef.current = true;
      setUserCoords({
        latitude: initialParams.latitude!,
        longitude: initialParams.longitude!,
      });
      setNewLat(initialParams.latitude!.toFixed(6));
      setNewLng(initialParams.longitude!.toFixed(6));
    } else {
      coordinateInputsTouchedRef.current = false;
    }
  }, [initialParams]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const initialiseLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (cancelled) return;

        if (permission.status !== 'granted') {
          setLocationError('LOCATION PERMISSION DENIED. ENTER CACHE COORDINATES MANUALLY.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (cancelled) return;

        const coordinates = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };

        if (isValidCoordinate(coordinates.latitude, coordinates.longitude)) {
          setUserCoords(coordinates);
          setLocationError(null);

          if (!coordinateInputsTouchedRef.current) {
            setNewLat(coordinates.latitude.toFixed(6));
            setNewLng(coordinates.longitude.toFixed(6));
          }
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_UPDATE_INTERVAL_MS,
            distanceInterval: LOCATION_UPDATE_DISTANCE_M,
          },
          (updatedLocation) => {
            const nextCoordinates = {
              latitude: updatedLocation.coords.latitude,
              longitude: updatedLocation.coords.longitude,
            };

            if (!isValidCoordinate(nextCoordinates.latitude, nextCoordinates.longitude)) {
              return;
            }

            setUserCoords(nextCoordinates);
            setLocationError(null);

            if (!coordinateInputsTouchedRef.current) {
              setNewLat(nextCoordinates.latitude.toFixed(6));
              setNewLng(nextCoordinates.longitude.toFixed(6));
            }
          }
        );
      } catch {
        if (!cancelled) {
          setLocationError('GPS UNAVAILABLE. CACHE DISTANCES CANNOT BE CALCULATED.');
        }
      }
    };

    initialiseLocation();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setFirestoreError(null);

    const treasuresQuery = query(
      collection(db, 'treasures'),
      where('isArchived', '==', false)
    );

    const unsubscribe = onSnapshot(
      treasuresQuery,
      (snapshot) => {
        const records = snapshot.docs
          .map((docSnap) => {
            const rawData = docSnap.data() as Partial<TreasureDocument>;
            return {
              id: docSnap.id,
              data: {
                ...rawData,
                treasureId: rawData.treasureId || docSnap.id,
              } as TreasureDocument,
            };
          })
          .filter(({ data }) => {
            const location = data.location;
            return Boolean(
              location &&
                isValidCoordinate(location.latitude, location.longitude) &&
                typeof data.creatorId === 'string' &&
                typeof data.title === 'string'
            );
          });

        setFirestoreTreasures(records);
        setIsLoading(false);
        setFirestoreError(null);
      },
      (error) => {
        setIsLoading(false);
        setFirestoreError(
          getFriendlyFirestoreError(error, 'FAILED TO SYNCHRONISE FIELD CACHE DATA.')
        );
      }
    );

    return () => unsubscribe();
  }, []);

  const nearbyCaches = useMemo<DisplayItem[]>(() => {
    if (!userCoords) return [];

    return firestoreTreasures
      .map(({ id, data }) => {
        const cacheLat = data.location.latitude;
        const cacheLng = data.location.longitude;
        const distanceKm = calculateHaversineDistance(
          userCoords.latitude,
          userCoords.longitude,
          cacheLat,
          cacheLng
        );

        return {
          id,
          dbRef: `CX-${id.substring(0, 4).toUpperCase()}`,
          title: data.title?.trim() || 'UNNAMED CACHE',
          category: 'cache' as const,
          iconType: 'map-pin' as const,
          coordinates: `${cacheLat.toFixed(4)}° ${cacheLat >= 0 ? 'N' : 'S'} / ${Math.abs(cacheLng).toFixed(4)}° ${cacheLng >= 0 ? 'E' : 'W'}`,
          rawLat: cacheLat,
          rawLng: cacheLng,
          distanceKm: Number(distanceKm.toFixed(2)),
          status: data.creatorId === currentUserId ? 'MY PLANTED CACHE' : 'FIELD TARGET',
          hint: data.hint,
          payloadText: data.payloadText,
          creatorId: data.creatorId,
          creatorName: data.creatorName,
          createdAt: data.createdAt,
        };
      })
      .filter((item) => item.distanceKm <= INVENTORY_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [currentUserId, firestoreTreasures, userCoords]);

  useEffect(() => {
    if (selectedId && nearbyCaches.some((item) => item.id === selectedId)) return;
    setSelectedId(nearbyCaches[0]?.id ?? null);
    setIsEditing(false);
  }, [nearbyCaches, selectedId]);

  const selectedItem = useMemo(
    () => nearbyCaches.find((item) => item.id === selectedId) ?? null,
    [nearbyCaches, selectedId]
  );

  const resetCreateForm = () => {
    setNewTitle('');
    setNewHint('');
    setNewPayload('');
    setFieldErrors({});

    if (userCoords) {
      setNewLat(userCoords.latitude.toFixed(6));
      setNewLng(userCoords.longitude.toFixed(6));
      coordinateInputsTouchedRef.current = false;
    } else {
      setNewLat('');
      setNewLng('');
      coordinateInputsTouchedRef.current = false;
    }
  };

  const openCreateMode = () => {
    setIsBurying(true);
    setIsEditing(false);
    setSelectedId(null);
    setFieldErrors({});

    if (!newLat || !newLng) {
      if (userCoords) {
        setNewLat(userCoords.latitude.toFixed(6));
        setNewLng(userCoords.longitude.toFixed(6));
        coordinateInputsTouchedRef.current = false;
      }
    }
  };

  const closeCreateMode = () => {
    setIsBurying(false);
    setIsEditing(false);
    resetCreateForm();
  };

  const validateCreateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const title = newTitle.trim();
    const latitude = parseCoordinate(newLat);
    const longitude = parseCoordinate(newLng);

    if (!title) {
      errors.title = 'CACHE TITLE IS REQUIRED.';
    } else if (title.length < MIN_TITLE_LENGTH) {
      errors.title = `CACHE TITLE MUST BE AT LEAST ${MIN_TITLE_LENGTH} CHARACTERS.`;
    }

    if (latitude === null || latitude < -90 || latitude > 90) {
      errors.latitude = 'LATITUDE MUST BE BETWEEN -90 AND 90.';
    }

    if (longitude === null || longitude < -180 || longitude > 180) {
      errors.longitude = 'LONGITUDE MUST BE BETWEEN -180 AND 180.';
    }

    setFieldErrors(errors);

    const firstError = Object.values(errors)[0];
    if (firstError) announce(firstError);

    return Object.keys(errors).length === 0;
  };

  const validateEditForm = (): boolean => {
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Validation Error', 'Cache title is required.');
      return false;
    }
    if (title.length < MIN_TITLE_LENGTH) {
      Alert.alert(
        'Validation Error',
        `Cache title must be at least ${MIN_TITLE_LENGTH} characters.`
      );
      return false;
    }
    return true;
  };

  const handleBuryCache = async () => {
    if (!auth.currentUser?.uid) {
      Alert.alert('Authentication Required', 'No active explorer session was found.');
      return;
    }

    if (!validateCreateForm()) return;

    const latitude = parseCoordinate(newLat);
    const longitude = parseCoordinate(newLng);
    if (latitude === null || longitude === null) return;

    const userId = auth.currentUser.uid;
    const creatorName =
      auth.currentUser.displayName?.trim() ||
      auth.currentUser.email?.split('@')[0]?.trim() ||
      'EXPLORER';
    const title = newTitle.trim().toUpperCase();
    const hint = newHint.trim() || 'No explicit clue recorded.';
    const payloadText = newPayload.trim() || 'Field secret stored.';

    setIsSubmitting(true);

    try {
      const treasureRef = doc(collection(db, 'treasures'));
      const activityRef = doc(collection(db, 'activity_feed'));

      const treasureData = {
        creatorId: userId,
        creatorName,
        title,
        hint,
        payloadText,
        location: new GeoPoint(latitude, longitude),
        isArchived: false,
        createdAt: serverTimestamp(),
      };

      const activityData = {
        userId,
        username: creatorName,
        type: 'TREASURE_HIDDEN',
        message: `Planted new cache [${title}] in sector.`,
        targetId: treasureRef.id,
        createdAt: serverTimestamp(),
      };

      const batch = writeBatch(db);
      batch.set(treasureRef, {
        ...treasureData,
        treasureId: treasureRef.id,
      });
      batch.set(activityRef, {
        ...activityData,
        activityId: activityRef.id,
      });
      await batch.commit();

      setIsBurying(false);
      setNewTitle('');
      setNewHint('');
      setNewPayload('');
      setFieldErrors({});
      setSelectedId(treasureRef.id);
      coordinateInputsTouchedRef.current = false;

      Alert.alert('Cache Anchored', `[${title}] has been sealed into the field network.`);
    } catch (error) {
      Alert.alert(
        'Creation Error',
        getFriendlyFirestoreError(error, 'Could not create the cache record.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginEditing = () => {
    if (!selectedItem) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the cache creator can edit this record.');
      return;
    }

    setEditTitle(selectedItem.title);
    setEditHint(selectedItem.hint ?? '');
    setEditPayload(selectedItem.payloadText ?? '');
    setIsEditing(true);
  };

  const handleUpdateCache = async () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the cache creator can edit this record.');
      return;
    }
    if (!validateEditForm()) return;

    setIsSubmitting(true);

    try {
      await updateDoc(doc(db, 'treasures', selectedItem.id), {
        title: editTitle.trim().toUpperCase(),
        hint: editHint.trim(),
        payloadText: editPayload.trim(),
      });

      setIsEditing(false);
      Alert.alert('Record Updated', 'Cache metadata has been updated successfully.');
    } catch (error) {
      Alert.alert(
        'Update Error',
        getFriendlyFirestoreError(error, 'Could not save cache changes.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveCache = () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the cache creator can archive this record.');
      return;
    }

    Alert.alert(
      'Archive Cache',
      `Deactivate “${selectedItem.title}” from active maps and inventory?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await updateDoc(doc(db, 'treasures', selectedItem.id), {
                isArchived: true,
              });
              setSelectedId(null);
              setIsEditing(false);
              Alert.alert('Cache Archived', 'The cache is now archived and hidden from active field lists.');
            } catch (error) {
              Alert.alert(
                'Archive Error',
                getFriendlyFirestoreError(error, 'Could not archive the cache.')
              );
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteCache = () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the cache creator can permanently delete this record.');
      return;
    }

    Alert.alert(
      'Permanent Deletion',
      `Permanently delete “${selectedItem.title}”? This cannot be undone. Existing discovery history for this cache will also be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const treasureId = selectedItem.id;
              const discoverySnapshot = await getDocs(
                query(collection(db, 'discoveries'), where('treasureId', '==', treasureId))
              );

              // Firestore batches are capped at 500 writes. Delete discovery records in
              // conservative chunks first, then remove the treasure document last. If a
              // chunk fails, the treasure remains available and the operation can be retried.
              for (let start = 0; start < discoverySnapshot.docs.length; start += FIRESTORE_SAFE_BATCH_SIZE) {
                const discoveryBatch = writeBatch(db);
                discoverySnapshot.docs
                  .slice(start, start + FIRESTORE_SAFE_BATCH_SIZE)
                  .forEach((discovery) => discoveryBatch.delete(discovery.ref));
                await discoveryBatch.commit();
              }

              const treasureBatch = writeBatch(db);
              treasureBatch.delete(doc(db, 'treasures', treasureId));
              await treasureBatch.commit();

              // Activity feed entries are intentionally retained as historical field signals.
              setSelectedId(null);
              setIsEditing(false);
              Alert.alert(
                'Record Deleted',
                'The cache and its discovery records were permanently removed. Historical activity signals were retained.'
              );
            } catch (error) {
              Alert.alert(
                'Deletion Failure',
                getFriendlyFirestoreError(error, 'Could not permanently delete the cache.')
              );
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleNav = (screen: string) => {
    setActiveScreen(screen as NavigationTab);
    onNavigate?.(screen);
  };

  const safePaddingLeft = Math.max(insets.left, 12);
  const safePaddingRight = Math.max(insets.right, 12);

  const renderErrorState = () => (
    <View
      style={styles.stateContainer}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <ShieldAlert size={28} stroke={COLORS.sienna} strokeWidth={2.2} />
      <Text style={styles.stateTitle}>FIELD CACHE SYNC FAILED</Text>
      <Text style={styles.stateText}>{firestoreError}</Text>
      <Text style={styles.stateHint}>
        Firestore will continue attempting to restore the live cache connection.
      </Text>
    </View>
  );

  const renderLocationUnavailable = () => (
    <View
      style={styles.stateContainer}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Navigation size={28} stroke={COLORS.sienna} strokeWidth={2.2} />
      <Text style={styles.stateTitle}>LOCATION UNAVAILABLE</Text>
      <Text style={styles.stateText}>
        {locationError || 'Your current coordinates are unavailable, so the 20 km cache filter cannot be calculated.'}
      </Text>
      <Text style={styles.stateHint}>
        You can still use BURY NEW CACHE and enter valid coordinates manually.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.splitWrapper,
          {
            flexDirection: isLandscape ? 'row' : 'column',
            paddingLeft: isLandscape ? safePaddingLeft : Math.max(insets.left, 8),
            paddingRight: isLandscape ? safePaddingRight : Math.max(insets.right, 8),
            paddingTop: Math.max(insets.top, 8),
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View
          style={[
            styles.leftViewport,
            { flex: isLandscape ? 0.6 : 1 },
            !isLandscape && styles.leftViewportPortrait,
          ]}
        >
          <View style={styles.tabHeaderRow}>
            <TouchableOpacity
              style={[styles.tabButton, styles.tabActive]}
              onPress={() => {
                setIsBurying(false);
                setIsEditing(false);
                setFieldErrors({});
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: true }}
              accessibilityLabel={`Field caches within ${INVENTORY_RADIUS_KM} kilometres, ${nearbyCaches.length} available`}
            >
              <Text style={[styles.tabText, styles.tabTextActive]}>
                FIELD CACHES ({INVENTORY_RADIUS_KM}KM) ({nearbyCaches.length})
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.leftSubHeader}>
            <View style={styles.sectionHeaderRow}>
              <FileSearch size={18} stroke={COLORS.ink} strokeWidth={2.1} />
              <Text style={styles.sectionTitle}>
                {isBurying ? 'FABRICATE & BURY NEW CACHE' : 'RADIAL CACHE MESH (20KM)'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.buryToggleButton}
              onPress={isBurying ? closeCreateMode : openCreateMode}
              accessibilityRole="button"
              accessibilityLabel={isBurying ? 'Cancel bury new cache' : 'Bury new cache'}
              accessibilityHint={
                isBurying
                  ? 'Returns to the field cache list.'
                  : 'Opens the cache creation form.'
              }
            >
              <View style={styles.btnInnerRow}>
                {isBurying ? (
                  <>
                    <ChevronLeft size={16} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
                    <Text style={styles.buryToggleText}>CANCEL</Text>
                  </>
                ) : (
                  <>
                    <Plus size={16} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
                    <Text style={styles.buryToggleText}>BURY NEW CACHE</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>

          {isBurying ? (
            <Animated.View
              entering={reduceMotionEnabled ? undefined : FadeIn.duration(200)}
              exiting={reduceMotionEnabled ? undefined : FadeOut.duration(150)}
              style={styles.flexOne}
            >
              <ScrollView
                style={styles.formContainer}
                contentContainerStyle={styles.formContentContainer}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.label}>CACHE TITLE / DESIGNATION</Text>
                <TextInput
                  style={[styles.input, fieldErrors.title ? styles.inputError : null]}
                  placeholder="e.g., QUADRANGLE CLOCKTOWER"
                  placeholderTextColor="#A09580"
                  value={newTitle}
                  onChangeText={(value) => {
                    setNewTitle(value);
                    if (fieldErrors.title) {
                      setFieldErrors((previous) => ({ ...previous, title: '' }));
                    }
                  }}
                  maxLength={80}
                  returnKeyType="next"
                  accessibilityLabel="Cache title"
                  accessibilityHint="Enter a title of at least three characters."
                />
                {fieldErrors.title ? <Text style={styles.errorText} accessibilityLiveRegion="assertive">{fieldErrors.title}</Text> : null}

                <Text style={styles.label}>CLUE / RIDDLE HINT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter cryptic clue..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={3}
                  value={newHint}
                  onChangeText={setNewHint}
                  maxLength={500}
                  accessibilityLabel="Cache clue or riddle hint"
                />

                <Text style={styles.label}>SECRET PAYLOAD CONTENT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Secret message revealed upon extraction..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={3}
                  value={newPayload}
                  onChangeText={setNewPayload}
                  maxLength={1000}
                  accessibilityLabel="Secret payload content"
                />

                <View style={styles.coordsHeaderRow}>
                  <Text style={styles.label}>CACHE LOCATION</Text>
                  {userCoords ? (
                    <Text style={styles.gpsStatus}>GPS LOCKED</Text>
                  ) : (
                    <Text style={styles.gpsStatusWarning}>GPS UNAVAILABLE</Text>
                  )}
                </View>

                <View style={styles.coordsRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.label}>LATITUDE (-90 TO 90)</Text>
                    <TextInput
                      style={[styles.input, fieldErrors.latitude ? styles.inputError : null]}
                      value={newLat}
                      onChangeText={(value) => {
                        coordinateInputsTouchedRef.current = true;
                        setNewLat(value);
                        if (fieldErrors.latitude) {
                          setFieldErrors((previous) => ({ ...previous, latitude: '' }));
                        }
                      }}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Cache latitude"
                    accessibilityHint="Enter a latitude from minus 90 to 90 degrees."
                    />
                    {fieldErrors.latitude ? (
                      <Text style={styles.errorText} accessibilityLiveRegion="assertive">{fieldErrors.latitude}</Text>
                    ) : null}
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.label}>LONGITUDE (-180 TO 180)</Text>
                    <TextInput
                      style={[styles.input, fieldErrors.longitude ? styles.inputError : null]}
                      value={newLng}
                      onChangeText={(value) => {
                        coordinateInputsTouchedRef.current = true;
                        setNewLng(value);
                        if (fieldErrors.longitude) {
                          setFieldErrors((previous) => ({ ...previous, longitude: '' }));
                        }
                      }}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Cache longitude"
                    accessibilityHint="Enter a longitude from minus 180 to 180 degrees."
                    />
                    {fieldErrors.longitude ? (
                      <Text style={styles.errorText} accessibilityLiveRegion="assertive">{fieldErrors.longitude}</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.coordinateHelp}>
                  {userCoords
                    ? 'Current GPS coordinates are available. You may edit them before burying the cache.'
                    : 'Enter valid coordinates manually because a GPS position is not currently available.'}
                </Text>

                <AnimatedTouchableOpacity
                  style={[styles.sealAndBuryBtn, isSubmitting && styles.disabledButton]}
                  onPress={handleBuryCache}
                  disabled={isSubmitting}
                  accessibilityLabel="Seal and bury cache"
                  accessibilityHint="Creates the cache and its activity record in Firestore."
                  reduceMotion={reduceMotionEnabled}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#F3ECD8" />
                  ) : (
                    <Text style={styles.sealAndBuryText}>SEAL & BURY CACHE</Text>
                  )}
                </AnimatedTouchableOpacity>
              </ScrollView>
            </Animated.View>
          ) : firestoreError ? (
            renderErrorState()
          ) : isLoading ? (
            <View style={styles.loadingContainer} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" color="#A64B2A" />
              <Text style={styles.loadingText}>SCANNING RADIAL FIELD...</Text>
            </View>
          ) : !userCoords ? (
            renderLocationUnavailable()
          ) : (
            <ScrollView
              contentContainerStyle={styles.gridContainer}
              showsVerticalScrollIndicator={false}
            >
              <Animated.View
                layout={reduceMotionEnabled ? undefined : Layout.springify()}
                style={styles.grid}
              >
                {nearbyCaches.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const isOwner = item.creatorId === currentUserId;

                  return (
                    <AnimatedTouchableOpacity
                      key={item.id}
                      style={[
                        styles.itemCard,
                        isSelected && styles.itemCardSelected,
                        isOwner && styles.itemCardOwner,
                      ]}
                      onPress={() => {
                        setSelectedId(item.id);
                        setIsEditing(false);
                      }}
                      accessibilityLabel={`${item.title}. ${item.distanceKm} kilometres away. ${
                        isOwner ? 'Planted by you.' : `Created by ${getSafeCreatorName(item.creatorName)}.`
                      }`}
                      accessibilityHint="Selects this cache to view its details."
                      selected={isSelected}
                      reduceMotion={reduceMotionEnabled}
                    >
                      <View style={styles.cardHeaderRow}>
                        <ItemIcon
                          type={item.iconType}
                          size={18}
                          stroke={isSelected ? COLORS.sienna : COLORS.ink}
                        />
                        <View style={styles.distBadge}>
                          <Navigation size={12} stroke={COLORS.ink} strokeWidth={2.1} />
                          <Text style={styles.distBadgeText}>{item.distanceKm} km</Text>
                        </View>
                      </View>
                      <Text style={styles.itemText} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.itemSubtext} numberOfLines={1}>
                        {isOwner ? 'PLANTED BY YOU' : `BY: ${getSafeCreatorName(item.creatorName)}`}
                      </Text>
                    </AnimatedTouchableOpacity>
                  );
                })}

                {nearbyCaches.length === 0 && (
                  <View style={styles.emptyState}>
                    <Radio size={30} stroke={COLORS.inkMuted} strokeWidth={2.1} />
                    <Text style={styles.emptyTitle}>NO ACTIVE CACHES DETECTED</Text>
                    <Text style={styles.emptyText}>
                      There are no active field caches within {INVENTORY_RADIUS_KM} km of your current coordinates.
                    </Text>
                    <Text style={styles.emptyHint}>
                      Use BURY NEW CACHE to place a new field target.
                    </Text>
                  </View>
                )}
              </Animated.View>
            </ScrollView>
          )}
        </View>

        <View
          style={[
            styles.rightViewport,
            { flex: isLandscape ? 0.4 : 1 },
            !isLandscape && styles.rightViewportPortrait,
          ]}
        >
          <View style={styles.telemetryPanel}>
            <View style={styles.panelHeaderRow}>
              <ShieldAlert size={18} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
              <Text style={styles.panelTitle}>INSPECTION TELEMETRY</Text>
            </View>
            <View style={styles.divider} />

            {selectedItem ? (
              isEditing ? (
                <ScrollView
                  style={styles.editScroll}
                  contentContainerStyle={styles.editScrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={styles.editHeader}>REFACTORS & EDITS</Text>
                  <Text style={styles.metaLabel}>TITLE</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    maxLength={80}
                    accessibilityLabel="Edit cache title"
                  />
                  <Text style={styles.metaLabel}>HINT / CLUE</Text>
                  <TextInput
                    style={[styles.editInput, styles.editTextArea]}
                    multiline
                    value={editHint}
                    onChangeText={setEditHint}
                    maxLength={500}
                    accessibilityLabel="Edit cache clue"
                  />
                  <Text style={styles.metaLabel}>PAYLOAD TEXT</Text>
                  <TextInput
                    style={[styles.editInput, styles.editTextArea]}
                    multiline
                    value={editPayload}
                    onChangeText={setEditPayload}
                    maxLength={1000}
                    accessibilityLabel="Edit cache payload"
                  />
                  <View style={styles.actionBtnRow}>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.saveButton, isSubmitting && styles.disabledButton]}
                      onPress={handleUpdateCache}
                      disabled={isSubmitting}
                      accessibilityRole="button"
                      accessibilityLabel="Save cache changes"
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" stroke={COLORS.parchmentLight} />
                      ) : (
                        <Text style={styles.smallBtnText}>SAVE</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.cancelButton]}
                      onPress={() => setIsEditing(false)}
                      disabled={isSubmitting}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel cache editing"
                    >
                      <Text style={styles.smallBtnText}>CANCEL</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <ScrollView
                  key={selectedItem.id}
                  style={styles.detailsScroll}
                  contentContainerStyle={styles.detailsBody}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.iconCircle}>
                    <ItemIcon type={selectedItem.iconType} size={22} stroke={COLORS.parchmentLight} />
                  </View>
                  <Text style={styles.itemHeaderTitle}>{selectedItem.title}</Text>
                  <Text style={styles.itemReference}>{selectedItem.dbRef}</Text>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>RADIAL DISTANCE</Text>
                    <Text style={styles.metaValue}>{selectedItem.distanceKm} KM</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>COORDINATES</Text>
                    <Text style={styles.metaValue}>{selectedItem.coordinates}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>CREATOR</Text>
                    <Text style={styles.metaValue}>{getSafeCreatorName(selectedItem.creatorName)}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>STATUS</Text>
                    <Text style={styles.metaValue}>{selectedItem.status}</Text>
                  </View>

                  {selectedItem.hint ? (
                    <View style={styles.hintBox}>
                      <Text style={styles.hintLabel}>CLUE RECORD:</Text>
                      <Text style={styles.hintText}>“{selectedItem.hint}”</Text>
                    </View>
                  ) : null}

                  {selectedItem.payloadText ? (
                    <View style={[styles.hintBox, styles.payloadBox]}>
                      <Text style={styles.hintLabel}>PAYLOAD RECORD:</Text>
                      <Text style={styles.hintText}>{selectedItem.payloadText}</Text>
                    </View>
                  ) : null}
                </ScrollView>
              )
            ) : (
              <View style={styles.detailsBody}>
                <Text style={styles.noSelectionText}>
                  No active cache is selected for telemetry analysis.
                </Text>
              </View>
            )}

            {selectedItem && selectedItem.creatorId === currentUserId && !isEditing ? (
              <View style={styles.creatorActionContainer}>
                <AnimatedTouchableOpacity
                  style={styles.editButton}
                  onPress={beginEditing}
                  disabled={isSubmitting}
                  accessibilityLabel={`Edit ${selectedItem.title}`}
                  accessibilityHint="Opens the cache metadata editing form."
                  reduceMotion={reduceMotionEnabled}
                >
                  <View style={styles.btnInnerRow}>
                    <Edit3 size={16} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
                    <Text style={styles.actionBtnText}>EDIT</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity
                  style={styles.archiveButton}
                  onPress={handleArchiveCache}
                  disabled={isSubmitting}
                  accessibilityLabel={`Archive ${selectedItem.title}`}
                  accessibilityHint="Removes this cache from active maps and inventory."
                  reduceMotion={reduceMotionEnabled}
                >
                  <View style={styles.btnInnerRow}>
                    <Archive size={16} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
                    <Text style={styles.actionBtnText}>ARCHIVE</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity
                  style={styles.deleteButton}
                  onPress={handleDeleteCache}
                  disabled={isSubmitting}
                  accessibilityLabel={`Permanently delete ${selectedItem.title}`}
                  accessibilityHint="Permanently deletes this cache and its discovery records."
                  reduceMotion={reduceMotionEnabled}
                >
                  <View style={styles.btnInnerRow}>
                    <Trash2 size={16} stroke={COLORS.parchmentLight} strokeWidth={2.1} />
                    <Text style={styles.deleteBtnText}>DELETE</Text>
                  </View>
                </AnimatedTouchableOpacity>
              </View>
            ) : null}
          </View>

          <FieldNavBar
            currentTab={activeScreen}
            onNavigate={handleNav}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  splitWrapper: {
    flex: 1,
    gap: 0,
  },
  flexOne: {
    flex: 1,
  },
  leftViewport: {
    minWidth: 0,
    minHeight: 0,
    backgroundColor: COLORS.parchment,
    padding: 14,
    borderRightWidth: 3,
    borderColor: COLORS.brass,
  },
  leftViewportPortrait: {
    borderRightWidth: 0,
    borderBottomWidth: 3,
  },
  tabHeaderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  tabButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.brass,
  },
  tabActive: {
    backgroundColor: COLORS.sienna,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tabTextActive: {
    color: COLORS.parchmentLight,
  },
  leftSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  sectionHeaderRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: COLORS.ink,
    letterSpacing: 0.5,
  },
  buryToggleButton: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    backgroundColor: COLORS.forest,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.brass,
  },
  btnInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buryToggleText: {
    color: COLORS.parchmentLight,
    fontSize: 11,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: {
    color: COLORS.sienna,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  gridContainer: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  itemCard: {
    width: 150,
    minHeight: 112,
    backgroundColor: COLORS.parchmentLight,
    borderWidth: 1,
    borderColor: COLORS.brass,
    borderRadius: 7,
    justifyContent: 'space-between',
    padding: 10,
  },
  itemCardSelected: {
    backgroundColor: '#D9C8A9',
    borderWidth: 3,
    borderColor: COLORS.sienna,
  },
  itemCardOwner: {
    borderLeftWidth: 5,
    borderLeftColor: COLORS.forest,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  distBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.parchment,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
  },
  distBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.ink,
  },
  itemText: {
    color: COLORS.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    marginVertical: 6,
  },
  itemSubtext: {
    color: COLORS.inkMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  emptyState: {
    padding: 28,
    alignItems: 'center',
    width: '100%',
    gap: 10,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  emptyText: {
    color: COLORS.inkMuted,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 480,
  },
  emptyHint: {
    color: COLORS.sienna,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  stateTitle: {
    color: COLORS.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.8,
  },
  stateText: {
    color: COLORS.inkMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 520,
  },
  stateHint: {
    color: COLORS.sienna,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: COLORS.parchmentLight,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.brass,
    padding: 12,
  },
  formContentContainer: {
    paddingBottom: 28,
  },
  label: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: COLORS.parchment,
    borderWidth: 1.5,
    borderColor: COLORS.brass,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.ink,
  },
  inputError: {
    borderColor: COLORS.sienna,
    borderWidth: 2,
  },
  errorText: {
    color: COLORS.sienna,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  coordsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  gpsStatus: {
    color: '#324B36',
    fontSize: 11,
    fontWeight: '800',
  },
  gpsStatusWarning: {
    color: COLORS.sienna,
    fontSize: 11,
    fontWeight: '800',
  },
  coordsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  coordinateHelp: {
    color: COLORS.inkMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  sealAndBuryBtn: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: COLORS.sienna,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.brass,
  },
  sealAndBuryText: {
    color: COLORS.parchmentLight,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.55,
  },
  rightViewport: {
    minWidth: 0,
    minHeight: 0,
    backgroundColor: COLORS.forest,
    padding: 12,
    justifyContent: 'space-between',
  },
  rightViewportPortrait: {
    borderTopWidth: 0,
  },
  telemetryPanel: {
    flex: 1,
    minHeight: 0,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  panelTitle: {
    flexShrink: 1,
    color: COLORS.parchmentLight,
    fontWeight: '800',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.brassLight,
    marginBottom: 8,
    opacity: 0.7,
  },
  detailsScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailsBody: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingBottom: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.forestDark,
    borderWidth: 1,
    borderColor: COLORS.brassLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemHeaderTitle: {
    color: COLORS.parchmentLight,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  itemReference: {
    color: COLORS.brassLight,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 10,
    marginVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#4B604E',
    paddingBottom: 6,
  },
  metaLabel: {
    color: COLORS.brassLight,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  metaValue: {
    flex: 1,
    color: COLORS.parchmentLight,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'right',
  },
  noSelectionText: {
    color: COLORS.brassLight,
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 18,
    textAlign: 'center',
  },
  hintBox: {
    marginTop: 10,
    backgroundColor: COLORS.forestDark,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.brassLight,
    width: '100%',
  },
  payloadBox: {
    marginTop: 8,
  },
  hintLabel: {
    color: COLORS.brassLight,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  hintText: {
    color: COLORS.parchmentLight,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  editScroll: {
    flex: 1,
    minHeight: 0,
  },
  editScrollContent: {
    paddingBottom: 12,
  },
  editHeader: {
    color: COLORS.parchmentLight,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  editInput: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: COLORS.forestDark,
    borderWidth: 1.5,
    borderColor: COLORS.brassLight,
    borderRadius: 6,
    color: COLORS.parchmentLight,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 10,
  },
  editTextArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  smallBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    backgroundColor: COLORS.sienna,
  },
  cancelButton: {
    backgroundColor: '#3A4B3C',
    borderWidth: 1,
    borderColor: COLORS.brassLight,
  },
  smallBtnText: {
    color: COLORS.parchmentLight,
    fontSize: 12,
    fontWeight: '800',
  },
  creatorActionContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  editButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: '#3A4B3C',
    borderWidth: 1,
    borderColor: COLORS.brassLight,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: '#5A4B2A',
    borderWidth: 1,
    borderColor: COLORS.brassLight,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: COLORS.sienna,
    borderWidth: 1,
    borderColor: COLORS.brassLight,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: COLORS.parchmentLight,
    fontSize: 11,
    fontWeight: '800',
  },
  deleteBtnText: {
    color: COLORS.parchmentLight,
    fontSize: 11,
    fontWeight: '800',
  },
});
