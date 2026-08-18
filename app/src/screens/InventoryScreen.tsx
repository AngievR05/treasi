import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
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
  MapPin,
  Target,
  Compass,
  Trophy,
  BookOpen,
  Plus,
  ChevronLeft,
  Package,
  ShieldAlert,
  FileSearch,
  Edit3,
  Trash2,
  Radio,
  Navigation,
  Archive,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  GeoPoint,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import {
  TreasureDocument,
  DiscoveryDocument,
  ActivityFeedDocument,
} from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

export type IconType = 'map-pin' | 'target' | 'compass' | 'trophy' | 'book';

export interface DisplayItem {
  id: string;
  dbRef: string;
  title: string;
  category: 'cache' | 'ephemera';
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
}

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: any;
}

interface InventoryScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string, params?: NavigationParams) => void;
  initialParams?: NavigationParams;
}

const calculateHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
  accessibilityLabel?: string;
}> = ({ onPress, style, children, disabled = false, accessibilityLabel }) => {
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
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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

  const [activeTab, setActiveTab] = useState<'cache' | 'ephemera'>('cache');
  const [activeScreen, setActiveScreen] = useState<NavigationTab>('INVENTORY');
  
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number }>({
    latitude: initialParams?.latitude ?? -25.7479,
    longitude: initialParams?.longitude ?? 28.2293,
  });

  const [nearbyCaches, setNearbyCaches] = useState<DisplayItem[]>([]);
  const [ephemeraList, setEphemeraList] = useState<DisplayItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Creation Form State
  const [isBurying, setIsBurying] = useState<boolean>(initialParams?.mode === 'create');
  const [newTitle, setNewTitle] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newPayload, setNewPayload] = useState('');
  const [newLat, setNewLat] = useState(
    initialParams?.latitude ? initialParams.latitude.toString() : '-25.7479'
  );
  const [newLng, setNewLng] = useState(
    initialParams?.longitude ? initialParams.longitude.toString() : '28.2293'
  );

  // Field Validation Error State
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});

  // Editing State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHint, setEditHint] = useState('');
  const [editPayload, setEditPayload] = useState('');

  const currentUserId = auth.currentUser?.uid;

  // React to incoming navigation parameters (Dashboard STAMP LOCATION trigger)
  useEffect(() => {
    if (initialParams?.mode === 'create') {
      setIsBurying(true);
      setActiveTab('cache');
      if (initialParams.latitude) setNewLat(initialParams.latitude.toString());
      if (initialParams.longitude) setNewLng(initialParams.longitude.toString());
    }
  }, [initialParams]);

  // GPS Telemetry Sync
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserCoords({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
          if (!initialParams?.latitude) setNewLat(location.coords.latitude.toFixed(6));
          if (!initialParams?.longitude) setNewLng(location.coords.longitude.toFixed(6));

          subscription = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10 },
            (loc) => {
              setUserCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
            }
          );
        }
      } catch (err) {
        console.warn('GPS Telemetry initialization fallback active:', err);
      }
    })();
    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  // Real-time Firestore Cache Read
  useEffect(() => {
    setIsLoading(true);
    const treasuresRef = collection(db, 'treasures');
    const q = query(treasuresRef, where('isArchived', '==', false));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loadedCaches: DisplayItem[] = [];
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as TreasureDocument;
          const cacheLat = data.location ? data.location.latitude : userCoords.latitude;
          const cacheLng = data.location ? data.location.longitude : userCoords.longitude;
          const distanceKm = calculateHaversineDistance(
            userCoords.latitude,
            userCoords.longitude,
            cacheLat,
            cacheLng
          );

          if (distanceKm <= 20.0) {
            loadedCaches.push({
              id: docSnap.id,
              dbRef: `CX-${docSnap.id.substring(0, 4).toUpperCase()}`,
              title: data.title || 'UNNAMED CACHE',
              category: 'cache',
              iconType: 'map-pin',
              coordinates: `${cacheLat.toFixed(4)}°S ${cacheLng.toFixed(4)}°E`,
              rawLat: cacheLat,
              rawLng: cacheLng,
              distanceKm: parseFloat(distanceKm.toFixed(2)),
              status: data.creatorId === currentUserId ? 'MY PLANTED CACHE' : 'FIELD TARGET',
              hint: data.hint,
              payloadText: data.payloadText,
              creatorId: data.creatorId,
              creatorName: data.creatorName,
            });
          }
        });

        loadedCaches.sort((a, b) => a.distanceKm - b.distanceKm);
        setNearbyCaches(loadedCaches);

        // Retain current selection if present; otherwise fallback to top element
        setSelectedId((prev) => {
          if (prev && loadedCaches.some((item) => item.id === prev)) return prev;
          return loadedCaches.length > 0 ? loadedCaches[0].id : null;
        });
        setIsLoading(false);
      },
      (error) => {
        console.error('Firestore cache read error:', error);
        Alert.alert('Telemetry Sync Error', 'Failed to scan radial field caches.');
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [userCoords.latitude, userCoords.longitude, currentUserId]);

  // Form Validation Engine
  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {};
    if (!newTitle.trim()) {
      errors.title = 'Title field cannot be empty.';
    } else if (newTitle.trim().length < 3) {
      errors.title = 'Title must be at least 3 characters.';
    }

    const latNum = parseFloat(newLat);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      errors.latitude = 'Latitude must be a valid number between -90 and 90.';
    }

    const lngNum = parseFloat(newLng);
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      errors.longitude = 'Longitude must be a valid number between -180 and 180.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // CREATE Operation
  const handleBuryCache = async () => {
    if (!currentUserId) {
      Alert.alert('Auth Error', 'No active session verified.');
      return;
    }
    if (!validateForm()) return;

    try {
      setIsSubmitting(true);
      const lat = parseFloat(newLat);
      const lng = parseFloat(newLng);
      const explorerName = auth.currentUser?.displayName || 'Unknown Explorer';

      const newTreasure: Omit<TreasureDocument, 'treasureId'> = {
        creatorId: currentUserId,
        creatorName: explorerName,
        title: newTitle.trim().toUpperCase(),
        hint: newHint.trim() || 'No explicit clue recorded.',
        payloadText: newPayload.trim() || 'Field secret stored.',
        location: new GeoPoint(lat, lng),
        isArchived: false,
        createdAt: serverTimestamp() as any,
      };

      const docRef = await addDoc(collection(db, 'treasures'), newTreasure);

      const activityPayload: Omit<ActivityFeedDocument, 'activityId'> = {
        userId: currentUserId,
        username: explorerName,
        type: 'TREASURE_HIDDEN',
        message: `Planted new cache [${newTitle.trim().toUpperCase()}] in sector.`,
        targetId: docRef.id,
        createdAt: serverTimestamp() as any,
      };
      await addDoc(collection(db, 'activity_feed'), activityPayload);

      setIsBurying(false);
      setNewTitle('');
      setNewHint('');
      setNewPayload('');
      setFieldErrors({});
      setSelectedId(docRef.id);
      Alert.alert('Cache Anchored', `[${newTitle.toUpperCase()}] sealed into Firestore grid.`);
    } catch (error: any) {
      Alert.alert('Creation Error', error?.message || 'Failed to seal record to database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // UPDATE Operation
  const handleUpdateCache = async () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'You do not own this cache record.');
      return;
    }
    if (!editTitle.trim()) {
      Alert.alert('Validation Error', 'Title field cannot be empty.');
      return;
    }

    try {
      setIsSubmitting(true);
      const treasureRef = doc(db, 'treasures', selectedItem.id);
      await updateDoc(treasureRef, {
        title: editTitle.trim().toUpperCase(),
        hint: editHint.trim(),
        payloadText: editPayload.trim(),
      });
      setIsEditing(false);
      Alert.alert('Record Updated', 'Cache metadata successfully refactored.');
    } catch (error: any) {
      Alert.alert('Update Error', error?.message || 'Could not commit updates.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ARCHIVE (Soft Delete) Operation
  const handleArchiveCache = async () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the creator can archive this record.');
      return;
    }

    Alert.alert(
      'Archive Cache',
      `Deactivate "${selectedItem.title}" from active field maps?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            try {
              setIsSubmitting(true);
              const docRef = doc(db, 'treasures', selectedItem.id);
              await updateDoc(docRef, { isArchived: true });
              setSelectedId(null);
              Alert.alert('Cache Archived', 'Item deactivated from active navigation lists.');
            } catch (error: any) {
              Alert.alert('Archive Error', error?.message || 'Failed to update record status.');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  // DELETE (Hard Delete) Operation
  const handleDeleteCache = async () => {
    if (!selectedItem || !currentUserId) return;
    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Error', 'Only the original creator may permanently delete this cache.');
      return;
    }

    Alert.alert(
      'PERMANENT DELETION WARNING',
      `Are you sure you want to permanently delete "${selectedItem.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Permanently Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSubmitting(true);
              const targetDocId = selectedItem.id;
              const treasureDocRef = doc(db, 'treasures', targetDocId);
              
              await deleteDoc(treasureDocRef);

              // Clear local state selection safely
              setSelectedId(null);
              setIsEditing(false);
              Alert.alert('Record Deleted', 'Cache document permanently erased from Firestore.');
            } catch (error: any) {
              Alert.alert('Deletion Failure', error?.message || 'Failed to erase document.');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const currentList = activeTab === 'cache' ? nearbyCaches : ephemeraList;
  const selectedItem =
    currentList.find((item) => item.id === selectedId) ||
    (currentList.length > 0 ? currentList[0] : null);

  const safePaddingLeft = Math.max(insets.left, 12);
  const safePaddingRight = Math.max(insets.right, 12);

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
        {/* LEFT 60% OPERATIONAL VIEWPORT */}
        <View style={styles.leftViewport}>
          <View style={styles.tabHeaderRow}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'cache' ? styles.tabActive : styles.tabInactive]}
              onPress={() => {
                setActiveTab('cache');
                setIsBurying(false);
                setIsEditing(false);
              }}
            >
              <Text style={[styles.tabText, activeTab === 'cache' ? styles.tabTextActive : styles.tabTextInactive]}>
                FIELD CACHES (20KM) ({nearbyCaches.length})
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.leftSubHeader}>
            <View style={styles.sectionHeaderRow}>
              <FileSearch size={14} color="#2A2420" />
              <Text style={styles.sectionTitle}>
                {isBurying
                  ? 'FABRICATE & BURY NEW CACHE'
                  : 'RADIAL CACHE MESH (20KM)'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.buryToggleButton}
              onPress={() => {
                setIsBurying(!isBurying);
                setIsEditing(false);
                setFieldErrors({});
              }}
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

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#A64B2A" />
              <Text style={styles.loadingText}>SCANNING RADIAL FIELD...</Text>
            </View>
          ) : isBurying ? (
            /* FORM: CREATE CACHE */
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={{ flex: 1 }}>
              <ScrollView style={styles.formContainer} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.label}>CACHE TITLE / DESIGNATION</Text>
                <TextInput
                  style={[styles.input, fieldErrors.title ? styles.inputError : null]}
                  placeholder="e.g., QUADRANGLE CLOCKTOWER"
                  placeholderTextColor="#A09580"
                  value={newTitle}
                  onChangeText={(val) => {
                    setNewTitle(val);
                    if (fieldErrors.title) setFieldErrors((prev) => ({ ...prev, title: '' }));
                  }}
                />
                {fieldErrors.title ? <Text style={styles.errorText}>{fieldErrors.title}</Text> : null}

                <Text style={styles.label}>CLUE / RIDDLE HINT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter cryptic clue..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={2}
                  value={newHint}
                  onChangeText={setNewHint}
                />

                <Text style={styles.label}>SECRET PAYLOAD CONTENT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Secret message revealed upon extraction..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={2}
                  value={newPayload}
                  onChangeText={setNewPayload}
                />

                <View style={styles.coordsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>LATITUDE (-90 to 90)</Text>
                    <TextInput
                      style={[styles.input, fieldErrors.latitude ? styles.inputError : null]}
                      value={newLat}
                      onChangeText={(val) => {
                        setNewLat(val);
                        if (fieldErrors.latitude) setFieldErrors((prev) => ({ ...prev, latitude: '' }));
                      }}
                      keyboardType="numeric"
                    />
                    {fieldErrors.latitude ? <Text style={styles.errorText}>{fieldErrors.latitude}</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>LONGITUDE (-180 to 180)</Text>
                    <TextInput
                      style={[styles.input, fieldErrors.longitude ? styles.inputError : null]}
                      value={newLng}
                      onChangeText={(val) => {
                        setNewLng(val);
                        if (fieldErrors.longitude) setFieldErrors((prev) => ({ ...prev, longitude: '' }));
                      }}
                      keyboardType="numeric"
                    />
                    {fieldErrors.longitude ? <Text style={styles.errorText}>{fieldErrors.longitude}</Text> : null}
                  </View>
                </View>

                <AnimatedTouchableOpacity
                  style={[styles.sealAndBuryBtn, isSubmitting && { opacity: 0.6 }]}
                  onPress={handleBuryCache}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#F3ECD8" />
                  ) : (
                    <Text style={styles.sealAndBuryText}>SEAL & BURY CACHE</Text>
                  )}
                </AnimatedTouchableOpacity>
              </ScrollView>
            </Animated.View>
          ) : (
            /* READ: GRID VIEW */
            <ScrollView contentContainerStyle={styles.gridContainer}>
              <Animated.View layout={Layout.springify()} style={styles.grid}>
                {currentList.map((item) => {
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
                    >
                      <View style={styles.cardHeaderRow}>
                        <ItemIcon type={item.iconType} size={18} color={isSelected ? '#A64B2A' : '#2A2420'} />
                        <View style={styles.distBadge}>
                          <Navigation size={8} color="#2A2420" />
                          <Text style={styles.distBadgeText}>{item.distanceKm} km</Text>
                        </View>
                      </View>
                      <Text style={styles.itemText} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.itemSubtext} numberOfLines={1}>
                        {isOwner ? 'PLANTED BY YOU' : `BY: ${item.creatorName || 'EXPLORER'}`}
                      </Text>
                    </AnimatedTouchableOpacity>
                  );
                })}
                {currentList.length === 0 && (
                  <View style={styles.emptyState}>
                    <Radio size={24} color="#8A7E6B" />
                    <Text style={styles.emptyText}>
                      No field caches detected within a 20km radius of your coordinates.
                    </Text>
                  </View>
                )}
              </Animated.View>
            </ScrollView>
          )}
        </View>

        {/* RIGHT 40% CONTROL VIEWPORT */}
        <View style={styles.rightViewport}>
          <View style={styles.telemetryPanel}>
            <View style={styles.panelHeaderRow}>
              <ShieldAlert size={14} color="#E8DCC0" />
              <Text style={styles.panelTitle}>INSPECTION TELEMETRY</Text>
            </View>
            <View style={styles.divider} />

            {selectedItem ? (
              isEditing ? (
                /* UPDATE FORM */
                <ScrollView style={{ flex: 1 }}>
                  <Text style={styles.editHeader}>REFACTORS & EDITS</Text>
                  <Text style={styles.metaLabel}>TITLE</Text>
                  <TextInput style={styles.editInput} value={editTitle} onChangeText={setEditTitle} />
                  <Text style={styles.metaLabel}>HINT / CLUE</Text>
                  <TextInput
                    style={[styles.editInput, { height: 36 }]}
                    multiline
                    value={editHint}
                    onChangeText={setEditHint}
                  />
                  <Text style={styles.metaLabel}>PAYLOAD TEXT</Text>
                  <TextInput
                    style={[styles.editInput, { height: 36 }]}
                    multiline
                    value={editPayload}
                    onChangeText={setEditPayload}
                  />
                  <View style={styles.actionBtnRow}>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: '#A64B2A' }]}
                      onPress={handleUpdateCache}
                      disabled={isSubmitting}
                    >
                      <Text style={styles.smallBtnText}>SAVE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: '#3A4B3C' }]}
                      onPress={() => setIsEditing(false)}
                    >
                      <Text style={styles.smallBtnText}>CANCEL</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                /* READ TELEMETRY DETAILS */
                <Animated.View entering={FadeIn.duration(200)} key={selectedItem.id} style={styles.detailsBody}>
                  <View style={styles.iconCircle}>
                    <ItemIcon type={selectedItem.iconType} size={22} color="#E8DCC0" />
                  </View>
                  <Text style={styles.itemHeaderTitle}>{selectedItem.title}</Text>
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
                    <Text style={styles.metaValue}>{selectedItem.creatorName || 'Explorer'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>STATUS</Text>
                    <Text style={styles.metaValue}>{selectedItem.status}</Text>
                  </View>
                  {selectedItem.hint && (
                    <View style={styles.hintBox}>
                      <Text style={styles.hintLabel}>CLUE RECORD:</Text>
                      <Text style={styles.hintText}>"{selectedItem.hint}"</Text>
                    </View>
                  )}
                  {selectedItem.payloadText && (
                    <View style={[styles.hintBox, { marginTop: 4 }]}>
                      <Text style={styles.hintLabel}>UNLOCKED PAYLOAD:</Text>
                      <Text style={styles.hintText}>{selectedItem.payloadText}</Text>
                    </View>
                  )}
                </Animated.View>
              )
            ) : (
              <View style={styles.detailsBody}>
                <Text style={styles.noSelectionText}>No active item selected for telemetry analysis.</Text>
              </View>
            )}

            {/* CREATOR ACTION CONTROLS (UPDATE / ARCHIVE / DELETE) */}
            {selectedItem && selectedItem.creatorId === currentUserId && !isEditing && (
              <View style={styles.creatorActionContainer}>
                <AnimatedTouchableOpacity
                  style={styles.editButton}
                  onPress={() => {
                    setEditTitle(selectedItem.title);
                    setEditHint(selectedItem.hint || '');
                    setEditPayload(selectedItem.payloadText || '');
                    setIsEditing(true);
                  }}
                >
                  <View style={styles.btnInnerRow}>
                    <Edit3 size={10} color="#E8DCC0" />
                    <Text style={styles.actionBtnText}>EDIT</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity style={styles.archiveButton} onPress={handleArchiveCache}>
                  <View style={styles.btnInnerRow}>
                    <Archive size={10} color="#E8DCC0" />
                    <Text style={styles.actionBtnText}>ARCHIVE</Text>
                  </View>
                </AnimatedTouchableOpacity>

                <AnimatedTouchableOpacity style={styles.deleteButton} onPress={handleDeleteCache}>
                  <View style={styles.btnInnerRow}>
                    <Trash2 size={10} color="#F3ECD8" />
                    <Text style={styles.deleteBtnText}>DELETE</Text>
                  </View>
                </AnimatedTouchableOpacity>
              </View>
            )}
          </View>

          <FieldNavBar currentTab={activeScreen as NavigationTab} onNavigate={(screen) => onNavigate?.(screen)} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2A2420' },
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.6, backgroundColor: '#E8DCC0', padding: 12, borderRightWidth: 3, borderColor: '#B08D57' },
  tabHeaderRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tabButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#B08D57' },
  tabActive: { backgroundColor: '#A64B2A' },
  tabInactive: { backgroundColor: '#F3ECD8' },
  tabText: { fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },
  tabTextActive: { color: '#F3ECD8' },
  tabTextInactive: { color: '#2A2420' },
  leftSubHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', color: '#2A2420', letterSpacing: 0.5 },
  buryToggleButton: { backgroundColor: '#2C3B2E', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 3, borderWidth: 1, borderColor: '#B08D57' },
  btnInnerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buryToggleText: { color: '#E8DCC0', fontSize: 8, fontWeight: 'bold' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText: { color: '#A64B2A', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
  gridContainer: { paddingBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  itemCard: { width: 105, height: 85, backgroundColor: '#F3ECD8', borderWidth: 1, borderColor: '#B08D57', borderRadius: 4, justifyContent: 'space-between', padding: 6 },
  itemCardSelected: { backgroundColor: '#D9C8A9', borderWidth: 2, borderColor: '#A64B2A' },
  itemCardOwner: { borderLeftWidth: 4, borderLeftColor: '#2C3B2E' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  distBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#E8DCC0', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  distBadgeText: { fontSize: 7, fontWeight: 'bold', color: '#2A2420' },
  itemText: { color: '#2A2420', fontSize: 9, fontWeight: 'bold' },
  itemSubtext: { color: '#8A7E6B', fontSize: 7, fontWeight: 'bold' },
  emptyState: { padding: 20, alignItems: 'center', width: '100%', gap: 8 },
  emptyText: { color: '#8A7E6B', fontSize: 10, fontStyle: 'italic', textAlign: 'center' },
  formContainer: { backgroundColor: '#F3ECD8', borderRadius: 4, borderWidth: 1, borderColor: '#B08D57', padding: 8 },
  label: { fontSize: 8, fontWeight: 'bold', color: '#2A2420', marginBottom: 2, marginTop: 4 },
  input: { backgroundColor: '#E8DCC0', borderWidth: 1, borderColor: '#B08D57', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, color: '#2A2420' },
  inputError: { borderColor: '#A64B2A', borderWidth: 1.5 },
  errorText: { color: '#A64B2A', fontSize: 7, fontWeight: 'bold', marginTop: 1 },
  textArea: { height: 34, textAlignVertical: 'top' },
  coordsRow: { flexDirection: 'row', gap: 6 },
  sealAndBuryBtn: { backgroundColor: '#A64B2A', paddingVertical: 8, borderRadius: 3, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#B08D57' },
  sealAndBuryText: { color: '#F3ECD8', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
  rightViewport: { flex: 0.4, backgroundColor: '#2C3B2E', padding: 10, justifyContent: 'space-between' },
  telemetryPanel: { flex: 1 },
  panelHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
  divider: { height: 1, backgroundColor: '#B08D57', marginBottom: 6 },
  detailsBody: { alignItems: 'center', paddingVertical: 2 },
  iconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1C2A20', borderWidth: 1, borderColor: '#B08D57', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  itemHeaderTitle: { color: '#E8DCC0', fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5, marginBottom: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginVertical: 1, borderBottomWidth: 0.5, borderBottomColor: '#3A4B3C', paddingBottom: 2 },
  metaLabel: { color: '#B08D57', fontSize: 8, fontWeight: 'bold' },
  metaValue: { color: '#E8DCC0', fontSize: 8 },
  noSelectionText: { color: '#B08D57', fontSize: 9, fontStyle: 'italic', marginTop: 14 },
  hintBox: { marginTop: 4, backgroundColor: '#1C2A20', padding: 5, borderRadius: 3, borderWidth: 1, borderColor: '#B08D57', width: '100%' },
  hintLabel: { color: '#B08D57', fontSize: 7, fontWeight: 'bold', marginBottom: 1 },
  hintText: { color: '#E8DCC0', fontSize: 8, fontStyle: 'italic' },
  editHeader: { color: '#E8DCC0', fontSize: 9, fontWeight: 'bold', marginBottom: 4 },
  editInput: { backgroundColor: '#1C2A20', borderWidth: 1, borderColor: '#B08D57', borderRadius: 3, color: '#E8DCC0', fontSize: 9, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 },
  actionBtnRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  smallBtn: { flex: 1, paddingVertical: 6, borderRadius: 3, alignItems: 'center' },
  smallBtnText: { color: '#E8DCC0', fontSize: 8, fontWeight: 'bold' },
  creatorActionContainer: { flexDirection: 'row', gap: 4, marginTop: 6 },
  editButton: { flex: 1, backgroundColor: '#3A4B3C', borderWidth: 1, borderColor: '#B08D57', paddingVertical: 6, borderRadius: 3, alignItems: 'center' },
  archiveButton: { flex: 1, backgroundColor: '#5A4B2A', borderWidth: 1, borderColor: '#B08D57', paddingVertical: 6, borderRadius: 3, alignItems: 'center' },
  deleteButton: { flex: 1, backgroundColor: '#A64B2A', borderWidth: 1, borderColor: '#B08D57', paddingVertical: 6, borderRadius: 3, alignItems: 'center' },
  actionBtnText: { color: '#E8DCC0', fontSize: 8, fontWeight: 'bold' },
  deleteBtnText: { color: '#F3ECD8', fontSize: 8, fontWeight: 'bold' },
});