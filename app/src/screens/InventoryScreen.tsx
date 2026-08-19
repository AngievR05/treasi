import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
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
import { ActivityFeedDocument, TreasureDocument } from '../types/firestore';
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

const ItemIcon: React.FC<{ type: IconType; size?: number; color?: string }> = ({
  type,
  size = 22,
  color = '#A64B2A',
}) => {
  switch (type) {
    case 'map-pin':
      return <MapPin size={size} color={color} />;
    case 'target':
      return <Target size={size} color={color} />;
    case 'compass':
      return <Compass size={size} color={color} />;
    case 'trophy':
      return <Trophy size={size} color={color} />;
    case 'book':
      return <BookOpen size={size} color={color} />;
    default:
      return <Package size={size} color={color} />;
  }
};

const AnimatedTouchableOpacity: React.FC<{
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}> = ({
  onPress,
  style,
  children,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => (scale.value = withSpring(0.96, { damping: 15 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 15 }))}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
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
    const creatorName = auth.currentUser.displayName?.trim() || 'EXPLORER';
    const title = newTitle.trim().toUpperCase();
    const hint = newHint.trim() || 'No explicit clue recorded.';
    const payloadText = newPayload.trim() || 'Field secret stored.';

    setIsSubmitting(true);

    try {
      const treasureRef = doc(collection(db, 'treasures'));
      const activityRef = doc(collection(db, 'activity_feed'));

      const treasureData: Omit<TreasureDocument, 'treasureId'> = {
        creatorId: userId,
        creatorName,
        title,
        hint,
        payloadText,
        location: new GeoPoint(latitude, longitude),
        isArchived: false,
        createdAt: serverTimestamp() as any,
      };

      const activityData: Omit<ActivityFeedDocument, 'activityId'> = {
        userId,
        username: creatorName,
        type: 'TREASURE_HIDDEN',
        message: `Planted new cache [${title}] in sector.`,
        targetId: treasureRef.id,
        createdAt: serverTimestamp() as any,
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

              const batch = writeBatch(db);
              batch.delete(doc(db, 'treasures', treasureId));
              discoverySnapshot.forEach((discovery) => batch.delete(discovery.ref));
              await batch.commit();

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
    <View style={styles.stateContainer}>
      <ShieldAlert size={28} color="#A64B2A" />
      <Text style={styles.stateTitle}>FIELD CACHE SYNC FAILED</Text>
      <Text style={styles.stateText}>{firestoreError}</Text>
      <Text style={styles.stateHint}>
        Firestore will continue attempting to restore the live cache connection.
      </Text>
    </View>
  );

  const renderLocationUnavailable = () => (
    <View style={styles.stateContainer}>
      <Navigation size={28} color="#A64B2A" />
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
            paddingLeft: isLandscape ? safePaddingLeft : 0,
            paddingRight: isLandscape ? safePaddingRight : 0,
          },
        ]}
      >
        <View style={styles.leftViewport}>
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
              <FileSearch size={14} color="#2A2420" />
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
                    <ChevronLeft size={12} color="#E8DCC0" />
                    <Text style={styles.buryToggleText}>CANCEL</Text>
                  </>
                ) : (
                  <>
                    <Plus size={12} color="#E8DCC0" />
                    <Text style={styles.buryToggleText}>BURY NEW CACHE</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          </View>

          {isBurying ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={{ flex: 1 }}
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
                  accessibilityLabel="Cache title"
                  accessibilityHint="Enter a title of at least three characters."
                />
                {fieldErrors.title ? <Text style={styles.errorText}>{fieldErrors.title}</Text> : null}

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
                  <View style={{ flex: 1 }}>
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
                    />
                    {fieldErrors.latitude ? (
                      <Text style={styles.errorText}>{fieldErrors.latitude}</Text>
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
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
                    />
                    {fieldErrors.longitude ? (
                      <Text style={styles.errorText}>{fieldErrors.longitude}</Text>
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
              <Animated.View layout={Layout.springify()} style={styles.grid}>
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
                    >
                      <View style={styles.cardHeaderRow}>
                        <ItemIcon
                          type={item.iconType}
                          size={18}
                          color={isSelected ? '#A64B2A' : '#2A2420'}
                        />
                        <View style={styles.distBadge}>
                          <Navigation size={8} color="#2A2420" />
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
                    <Radio size={28} color="#8A7E6B" />
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

        <View style={styles.rightViewport}>
          <View style={styles.telemetryPanel}>
            <View style={styles.panelHeaderRow}>
              <ShieldAlert size={14} color="#E8DCC0" />
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
                        <ActivityIndicator size="small" color="#E8DCC0" />
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
                <Animated.View
                  entering={FadeIn.duration(200)}
                  key={selectedItem.id}
                  style={styles.detailsBody}
                >
                  <View style={styles.iconCircle}>
                    <ItemIcon type={selectedItem.iconType} size={22} color="#E8DCC0" />
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
                </Animated.View>
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
                >
                  <View style={styles.btnInnerRow}>
                    <Edit3 size={10} color="#E8DCC0" />
                    <Text style={styles.actionBtnText}>EDIT</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity
                  style={styles.archiveButton}
                  onPress={handleArchiveCache}
                  disabled={isSubmitting}
                  accessibilityLabel={`Archive ${selectedItem.title}`}
                  accessibilityHint="Removes this cache from active maps and inventory."
                >
                  <View style={styles.btnInnerRow}>
                    <Archive size={10} color="#E8DCC0" />
                    <Text style={styles.actionBtnText}>ARCHIVE</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity
                  style={styles.deleteButton}
                  onPress={handleDeleteCache}
                  disabled={isSubmitting}
                  accessibilityLabel={`Permanently delete ${selectedItem.title}`}
                  accessibilityHint="Permanently deletes this cache and its discovery records."
                >
                  <View style={styles.btnInnerRow}>
                    <Trash2 size={10} color="#F3ECD8" />
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
    backgroundColor: '#2A2420',
  },
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
  },
  leftViewport: {
    flex: 0.6,
    minWidth: 0,
    backgroundColor: '#E8DCC0',
    padding: 12,
    borderRightWidth: 3,
    borderColor: '#B08D57',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  tabActive: {
    backgroundColor: '#A64B2A',
  },
  tabText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: '#F3ECD8',
  },
  leftSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 0.5,
  },
  buryToggleButton: {
    backgroundColor: '#2C3B2E',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  btnInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  buryToggleText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#A64B2A',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  gridContainer: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-start',
  },
  itemCard: {
    width: 115,
    minHeight: 88,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    justifyContent: 'space-between',
    padding: 7,
  },
  itemCardSelected: {
    backgroundColor: '#D9C8A9',
    borderWidth: 2,
    borderColor: '#A64B2A',
  },
  itemCardOwner: {
    borderLeftWidth: 4,
    borderLeftColor: '#2C3B2E',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  distBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#E8DCC0',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  distBadgeText: {
    fontSize: 7,
    fontWeight: 'bold',
    color: '#2A2420',
  },
  itemText: {
    color: '#2A2420',
    fontSize: 9,
    fontWeight: 'bold',
  },
  itemSubtext: {
    color: '#8A7E6B',
    fontSize: 7,
    fontWeight: 'bold',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
    width: '100%',
    gap: 8,
  },
  emptyTitle: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  emptyText: {
    color: '#8A7E6B',
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 14,
  },
  emptyHint: {
    color: '#A64B2A',
    fontSize: 8,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  stateTitle: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 0.8,
  },
  stateText: {
    color: '#8A7E6B',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 13,
  },
  stateHint: {
    color: '#A64B2A',
    fontSize: 8,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: '#F3ECD8',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 8,
  },
  formContentContainer: {
    paddingBottom: 20,
  },
  label: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#2A2420',
    marginBottom: 2,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 10,
    color: '#2A2420',
  },
  inputError: {
    borderColor: '#A64B2A',
    borderWidth: 1.5,
  },
  errorText: {
    color: '#A64B2A',
    fontSize: 7,
    fontWeight: 'bold',
    marginTop: 1,
  },
  textArea: {
    minHeight: 42,
    textAlignVertical: 'top',
  },
  coordsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gpsStatus: {
    color: '#3A4B3C',
    fontSize: 7,
    fontWeight: 'bold',
  },
  gpsStatusWarning: {
    color: '#A64B2A',
    fontSize: 7,
    fontWeight: 'bold',
  },
  coordsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  coordinateHelp: {
    color: '#8A7E6B',
    fontSize: 7,
    lineHeight: 10,
    marginTop: 4,
  },
  sealAndBuryBtn: {
    backgroundColor: '#A64B2A',
    paddingVertical: 8,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  sealAndBuryText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  disabledButton: {
    opacity: 0.6,
  },
  rightViewport: {
    flex: 0.4,
    minWidth: 0,
    backgroundColor: '#2C3B2E',
    padding: 10,
    justifyContent: 'space-between',
  },
  telemetryPanel: {
    flex: 1,
    minHeight: 0,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  panelTitle: {
    flexShrink: 1,
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#B08D57',
    marginBottom: 6,
  },
  detailsBody: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1C2A20',
    borderWidth: 1,
    borderColor: '#B08D57',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemHeaderTitle: {
    color: '#E8DCC0',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 2,
  },
  itemReference: {
    color: '#B08D57',
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
    marginVertical: 1,
    borderBottomWidth: 0.5,
    borderBottomColor: '#3A4B3C',
    paddingBottom: 2,
  },
  metaLabel: {
    color: '#B08D57',
    fontSize: 8,
    fontWeight: 'bold',
  },
  metaValue: {
    flexShrink: 1,
    color: '#E8DCC0',
    fontSize: 8,
    textAlign: 'right',
  },
  noSelectionText: {
    color: '#B08D57',
    fontSize: 9,
    fontStyle: 'italic',
    marginTop: 14,
    textAlign: 'center',
  },
  hintBox: {
    marginTop: 5,
    backgroundColor: '#1C2A20',
    padding: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#B08D57',
    width: '100%',
  },
  payloadBox: {
    marginTop: 4,
  },
  hintLabel: {
    color: '#B08D57',
    fontSize: 7,
    fontWeight: 'bold',
    marginBottom: 1,
  },
  hintText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontStyle: 'italic',
    lineHeight: 11,
  },
  editScroll: {
    flex: 1,
  },
  editScrollContent: {
    paddingBottom: 8,
  },
  editHeader: {
    color: '#E8DCC0',
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  editInput: {
    backgroundColor: '#1C2A20',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 3,
    color: '#E8DCC0',
    fontSize: 9,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 4,
  },
  editTextArea: {
    minHeight: 42,
    textAlignVertical: 'top',
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  smallBtn: {
    flex: 1,
    minHeight: 28,
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    backgroundColor: '#A64B2A',
  },
  cancelButton: {
    backgroundColor: '#3A4B3C',
  },
  smallBtnText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },
  creatorActionContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  editButton: {
    flex: 1,
    backgroundColor: '#3A4B3C',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
  },
  archiveButton: {
    flex: 1,
    backgroundColor: '#5A4B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
  },
  deleteButton: {
    flex: 1,
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },
  deleteBtnText: {
    color: '#F3ECD8',
    fontSize: 8,
    fontWeight: 'bold',
  },
});
