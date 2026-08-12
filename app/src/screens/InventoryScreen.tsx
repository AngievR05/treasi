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
  Camera,
  Flame,
  Plus,
  ChevronLeft,
  Package,
  ShieldAlert,
  FileSearch,
  Edit3,
  Trash2,
  Radio,
  Navigation,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  GeoPoint,
  serverTimestamp,
} from 'firebase/firestore';

// Core Application References & Types
import { db, auth } from '../config/firebase';
import {
  TreasureDocument,
  DiscoveryDocument,
  ActivityFeedDocument,
} from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

export type IconType = 'map-pin' | 'target' | 'compass' | 'trophy' | 'book' | 'camera';

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

interface InventoryScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

// Haversine Distance Calculation (Km)
const calculateHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth Radius in Km
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

// Vector Icon Renderer
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
    case 'camera':
      return <Camera size={size} color={color} />;
    default:
      return <Package size={size} color={color} />;
  }
};

// Micro-Interaction Tactile Button Wrapper
const AnimatedTouchableOpacity: React.FC<{
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
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
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  onBack,
  onNavigate,
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  // Tab & Screen Navigation
  const [activeTab, setActiveTab] = useState<'cache' | 'ephemera'>('cache');
  const [activeScreen, setActiveScreen] = useState<NavigationTab>('INVENTORY');

  // Device Location Telemetry State (Default to Pretoria/Campus fallback)
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number }>({
    latitude: -25.7479,
    longitude: 28.2293,
  });

  // Real-Time Firestore State
  const [nearbyCaches, setNearbyCaches] = useState<DisplayItem[]>([]);
  const [ephemeraList, setEphemeraList] = useState<DisplayItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form State: CREATE (Bury Cache Mode)
  const [isBurying, setIsBurying] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newPayload, setNewPayload] = useState('');
  const [newLat, setNewLat] = useState('-25.7479');
  const [newLng, setNewLng] = useState('28.2293');

  // Form State: UPDATE (Edit Cache Mode)
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHint, setEditHint] = useState('');
  const [editPayload, setEditPayload] = useState('');

  const currentUserId = auth.currentUser?.uid;

  // 1. Hardware GPS Location Hook
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
          setNewLat(location.coords.latitude.toFixed(4));
          setNewLng(location.coords.longitude.toFixed(4));

          subscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 10000,
              distanceInterval: 10,
            },
            (loc) => {
              setUserCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
            }
          );
        }
      } catch (err) {
        console.warn('GPS Telemetry initialization warning, fallback active:', err);
      }
    })();

    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  // 2. READ: Live Firestore Listener for Active Caches within 20km Radius
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

          // Calculate distance relative to current device GPS
          const distanceKm = calculateHaversineDistance(
            userCoords.latitude,
            userCoords.longitude,
            cacheLat,
            cacheLng
          );

          // Spatial Boundary: Filter items within 20km radius
          if (distanceKm <= 20.0) {
            const latStr = cacheLat.toFixed(4);
            const lngStr = cacheLng.toFixed(4);

            loadedCaches.push({
              id: docSnap.id,
              dbRef: `CX-${docSnap.id.substring(0, 4).toUpperCase()}`,
              title: data.title || 'UNNAMED CACHE',
              category: 'cache',
              iconType: 'map-pin',
              coordinates: `${latStr}°S ${lngStr}°E`,
              rawLat: cacheLat,
              rawLng: cacheLng,
              distanceKm: parseFloat(distanceKm.toFixed(2)),
              status:
                data.creatorId === currentUserId ? 'MY PLANTED CACHE' : 'FIELD TARGET',
              hint: data.hint,
              payloadText: data.payloadText,
              creatorId: data.creatorId,
              creatorName: data.creatorName,
            });
          }
        });

        // Sort nearest first
        loadedCaches.sort((a, b) => a.distanceKm - b.distanceKm);

        setNearbyCaches(loadedCaches);
        if (activeTab === 'cache' && loadedCaches.length > 0 && !selectedId) {
          setSelectedId(loadedCaches[0].id);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('Firestore 20km cache polling error:', error);
        Alert.alert('Telemetry Sync Error', 'Failed to scan radial field caches.');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userCoords.latitude, userCoords.longitude, currentUserId, activeTab]);

  // 3. READ: Live Firestore Listener for Discovered Ephemera
  useEffect(() => {
    if (!currentUserId) return;

    const discoveriesRef = collection(db, 'discoveries');
    const q = query(discoveriesRef, where('hunterId', '==', currentUserId));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const discoveryDocIds = snapshot.docs.map(
          (docSnap) => (docSnap.data() as DiscoveryDocument).treasureId
        );

        if (discoveryDocIds.length === 0) {
          setEphemeraList([]);
          return;
        }

        const treasuresRef = collection(db, 'treasures');
        const treasuresUnsub = onSnapshot(treasuresRef, (tSnapshot) => {
          const unlockedItems: DisplayItem[] = tSnapshot.docs
            .filter((tDoc) => discoveryDocIds.includes(tDoc.id))
            .map((tDoc) => {
              const data = tDoc.data() as TreasureDocument;
              const cacheLat = data.location ? data.location.latitude : userCoords.latitude;
              const cacheLng = data.location ? data.location.longitude : userCoords.longitude;
              const distanceKm = calculateHaversineDistance(
                userCoords.latitude,
                userCoords.longitude,
                cacheLat,
                cacheLng
              );

              return {
                id: tDoc.id,
                dbRef: `EP-${tDoc.id.substring(0, 4).toUpperCase()}`,
                title: data.title || 'UNEARTHED ARTIFACT',
                category: 'ephemera',
                iconType: 'trophy',
                coordinates: `${cacheLat.toFixed(4)}°S ${cacheLng.toFixed(4)}°E`,
                rawLat: cacheLat,
                rawLng: cacheLng,
                distanceKm: parseFloat(distanceKm.toFixed(2)),
                status: 'EXCAVATED',
                hint: data.hint,
                payloadText: data.payloadText,
                creatorId: data.creatorId,
                creatorName: data.creatorName,
              };
            });

          setEphemeraList(unlockedItems);
          if (activeTab === 'ephemera' && unlockedItems.length > 0 && !selectedId) {
            setSelectedId(unlockedItems[0].id);
          }
        });

        return () => treasuresUnsub();
      },
      (error) => {
        console.error('Firestore discoveries polling error:', error);
      }
    );

    return () => unsubscribe();
  }, [currentUserId, activeTab, userCoords]);

  // Active Item Derived Selection
  const currentList = activeTab === 'cache' ? nearbyCaches : ephemeraList;
  const selectedItem =
    currentList.find((item) => item.id === selectedId) ||
    (currentList.length > 0 ? currentList[0] : null);

  const handleNavigate = (screen: string) => {
    setActiveScreen(screen as NavigationTab);
    onNavigate?.(screen);
  };

  // Populate Edit Fields when item selection or edit mode toggles
  const startEditMode = () => {
    if (!selectedItem) return;
    setEditTitle(selectedItem.title);
    setEditHint(selectedItem.hint || '');
    setEditPayload(selectedItem.payloadText || '');
    setIsEditing(true);
  };

  // CREATE: Bury New Cache
  const handleBuryCache = async () => {
    if (!currentUserId) {
      Alert.alert('Authentication Failure', 'No authenticated Explorer session active.');
      return;
    }

    if (!newTitle.trim()) {
      Alert.alert('Field Validation Error', 'Please supply a cache title.');
      return;
    }

    try {
      setIsSubmitting(true);
      const lat = parseFloat(newLat) || userCoords.latitude;
      const lng = parseFloat(newLng) || userCoords.longitude;
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

      // Log Signal to Activity Feed Collection
      const activityPayload: Omit<ActivityFeedDocument, 'activityId'> = {
        userId: currentUserId,
        username: explorerName,
        type: 'TREASURE_HIDDEN',
        message: `Planted new cache [${newTitle.trim().toUpperCase()}] in field sector.`,
        targetId: docRef.id,
        createdAt: serverTimestamp() as any,
      };
      await addDoc(collection(db, 'activity_feed'), activityPayload);

      setIsBurying(false);
      setNewTitle('');
      setNewHint('');
      setNewPayload('');
      setSelectedId(docRef.id);
      Alert.alert('Cache Anchored', `[${newTitle.toUpperCase()}] sealed into 20km Firestore grid.`);
    } catch (error: any) {
      console.error('Error anchoring cache:', error);
      Alert.alert('Fabrication Error', error?.message || 'Failed to register cache with remote server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // UPDATE: Commit Cache Revisions
  const handleUpdateCache = async () => {
    if (!selectedItem || !currentUserId) return;

    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Denied', 'Only the original Hider can update cache metadata.');
      return;
    }

    if (!editTitle.trim()) {
      Alert.alert('Validation Error', 'Title field cannot be left blank.');
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
      Alert.alert('Record Refactored', 'Cache metadata successfully updated.');
    } catch (error: any) {
      console.error('Error updating cache:', error);
      Alert.alert('Update Failed', error?.message || 'Could not update record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // DELETE: Soft Delete (Archive Evidence)
  const handleBurnEvidence = () => {
    if (!selectedItem || !currentUserId) return;

    if (selectedItem.creatorId !== currentUserId) {
      Alert.alert('Permission Denied', 'Only the cache creator may purge this record.');
      return;
    }

    Alert.alert(
      'Burn Evidence',
      `Permanently retract "${selectedItem.title}" from the active field network?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              const treasureDocRef = doc(db, 'treasures', selectedItem.id);
              await updateDoc(treasureDocRef, {
                isArchived: true,
              });

              setSelectedId(null);
              Alert.alert('Record Expunged', 'Cache successfully archived.');
            } catch (error: any) {
              console.error('Error erasing cache:', error);
              Alert.alert('Erasure Failed', error?.message || 'Failed to update document status.');
            }
          },
        },
      ]
    );
  };

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
          {/* Header Navigation Tabs */}
          <View style={styles.tabHeaderRow}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'cache' ? styles.tabActive : styles.tabInactive,
              ]}
              onPress={() => {
                setActiveTab('cache');
                setIsBurying(false);
                setIsEditing(false);
                if (nearbyCaches.length > 0) setSelectedId(nearbyCaches[0].id);
              }}
              accessible={true}
              accessibilityRole="tab"
              accessibilityLabel="Field Caches within 20 kilometers Tab"
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'cache' ? styles.tabTextActive : styles.tabTextInactive,
                ]}
              >
                FIELD CACHES (20KM) ({nearbyCaches.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'ephemera' ? styles.tabActive : styles.tabInactive,
              ]}
              onPress={() => {
                setActiveTab('ephemera');
                setIsBurying(false);
                setIsEditing(false);
                if (ephemeraList.length > 0) setSelectedId(ephemeraList[0].id);
              }}
              accessible={true}
              accessibilityRole="tab"
              accessibilityLabel="Collected Ephemera Tab"
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'ephemera' ? styles.tabTextActive : styles.tabTextInactive,
                ]}
              >
                COLLECTED EPHEMERA ({ephemeraList.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sub-Header Actions */}
          <View style={styles.leftSubHeader}>
            <View style={styles.sectionHeaderRow}>
              <FileSearch size={14} color="#2A2420" style={styles.titleIcon} />
              <Text style={styles.sectionTitle}>
                {isBurying
                  ? 'FABRICATE & BURY NEW CACHE'
                  : activeTab === 'cache'
                  ? 'RADIAL CACHE MESH (20KM)'
                  : 'EXCAVATED ARTIFACT LOG'}
              </Text>
            </View>

            {activeTab === 'cache' && (
              <TouchableOpacity
                style={styles.buryToggleButton}
                onPress={() => {
                  setIsBurying(!isBurying);
                  setIsEditing(false);
                }}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Toggle Bury New Cache Form"
              >
                {isBurying ? (
                  <View style={styles.btnInnerRow}>
                    <ChevronLeft size={12} color="#E8DCC0" />
                    <Text style={styles.buryToggleText}>CANCEL</Text>
                  </View>
                ) : (
                  <View style={styles.btnInnerRow}>
                    <Plus size={12} color="#E8DCC0" />
                    <Text style={styles.buryToggleText}>BURY NEW CACHE</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Content View: Loading OR Form OR Item Grid */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#A64B2A" />
              <Text style={styles.loadingText}>SCANNING 20KM GPS RADIAL FIELD...</Text>
            </View>
          ) : isBurying ? (
            /* CREATE: BURY CACHE FORM */
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={{ flex: 1 }}
            >
              <ScrollView
                style={styles.formContainer}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                <Text style={styles.label}>CACHE TITLE / DESIGNATION</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., QUADRANGLE CLOCKTOWER"
                  placeholderTextColor="#A09580"
                  value={newTitle}
                  onChangeText={setNewTitle}
                />

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
                  placeholder="Secret payload revealed upon extraction..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={2}
                  value={newPayload}
                  onChangeText={setNewPayload}
                />

                <View style={styles.coordsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>LATITUDE</Text>
                    <TextInput
                      style={styles.input}
                      value={newLat}
                      onChangeText={setNewLat}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>LONGITUDE</Text>
                    <TextInput
                      style={styles.input}
                      value={newLng}
                      onChangeText={setNewLng}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <AnimatedTouchableOpacity
                  style={[styles.sealAndBuryBtn, isSubmitting && { opacity: 0.6 }]}
                  onPress={handleBuryCache}
                  disabled={isSubmitting}
                  accessibilityLabel="Seal and Bury Cache in Firestore"
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
                      accessibilityLabel={`Select item ${item.title}`}
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
                  <TextInput
                    style={styles.editInput}
                    value={editTitle}
                    onChangeText={setEditTitle}
                  />

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
                <Animated.View
                  entering={FadeIn.duration(200)}
                  key={selectedItem.id}
                  style={styles.detailsBody}
                >
                  <View style={styles.iconCircle}>
                    <ItemIcon
                      type={selectedItem.iconType}
                      size={22}
                      color="#E8DCC0"
                    />
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
                    <Text style={styles.metaValue}>
                      {selectedItem.creatorName || 'Explorer'}
                    </Text>
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
                <Text style={styles.noSelectionText}>
                  No active item selected for telemetry analysis.
                </Text>
              </View>
            )}

            {/* CREATOR CONTROL ACTIONS (UPDATE / DELETE) */}
            {selectedItem &&
              activeTab === 'cache' &&
              selectedItem.creatorId === currentUserId &&
              !isEditing && (
                <View style={styles.creatorActionContainer}>
                  <AnimatedTouchableOpacity
                    style={styles.editButton}
                    onPress={startEditMode}
                    accessibilityLabel="Edit cache record"
                  >
                    <View style={styles.btnInnerRow}>
                      <Edit3 size={12} color="#E8DCC0" />
                      <Text style={styles.actionBtnText}>REFACTOR</Text>
                    </View>
                  </AnimatedTouchableOpacity>

                  <AnimatedTouchableOpacity
                    style={styles.burnButton}
                    onPress={handleBurnEvidence}
                    accessibilityLabel="Burn Evidence and Erase Cache"
                  >
                    <View style={styles.btnInnerRow}>
                      <Flame size={12} color="#F3ECD8" />
                      <Text style={styles.burnButtonText}>BURN EVIDENCE</Text>
                    </View>
                  </AnimatedTouchableOpacity>
                </View>
              )}
          </View>

          {/* Integrated Field Navigation Bar */}
          <FieldNavBar
            currentTab={activeScreen as NavigationTab}
            onNavigate={handleNavigate}
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

  /* LEFT 60% OPERATIONAL VIEWPORT */
  leftViewport: {
    flex: 0.6,
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
  tabInactive: {
    backgroundColor: '#F3ECD8',
  },
  tabText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: '#F3ECD8',
  },
  tabTextInactive: {
    color: '#2A2420',
  },
  leftSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleIcon: {
    marginTop: 1,
  },
  sectionTitle: {
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
    gap: 4,
  },
  buryToggleText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },

  /* LOADING & GRID STYLES */
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
    paddingBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  itemCard: {
    width: 105,
    height: 85,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    justifyContent: 'space-between',
    padding: 6,
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
    padding: 20,
    alignItems: 'center',
    width: '100%',
    gap: 8,
  },
  emptyText: {
    color: '#8A7E6B',
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  /* FORM STYLES (BURY CACHE) */
  formContainer: {
    backgroundColor: '#F3ECD8',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 8,
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
    paddingVertical: 3,
    fontSize: 10,
    color: '#2A2420',
  },
  textArea: {
    height: 34,
    textAlignVertical: 'top',
  },
  coordsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sealAndBuryBtn: {
    backgroundColor: '#A64B2A',
    paddingVertical: 8,
    borderRadius: 3,
    alignItems: 'center',
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

  /* RIGHT 40% CONTROL VIEWPORT */
  rightViewport: {
    flex: 0.4,
    backgroundColor: '#2C3B2E',
    padding: 10,
    justifyContent: 'space-between',
  },
  telemetryPanel: {
    flex: 1,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  panelTitle: {
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
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
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
    color: '#E8DCC0',
    fontSize: 8,
  },
  noSelectionText: {
    color: '#B08D57',
    fontSize: 9,
    fontStyle: 'italic',
    marginTop: 14,
  },
  hintBox: {
    marginTop: 4,
    backgroundColor: '#1C2A20',
    padding: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#B08D57',
    width: '100%',
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
  },

  /* UPDATE FORM (RIGHT PANEL) */
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
    paddingVertical: 2,
    marginBottom: 4,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
  },
  smallBtnText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },

  /* CREATOR ACTIONS CONTAINER */
  creatorActionContainer: {
    flexDirection: 'row',
    gap: 6,
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
  actionBtnText: {
    color: '#E8DCC0',
    fontSize: 8,
    fontWeight: 'bold',
  },
  burnButton: {
    flex: 1,
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 3,
    alignItems: 'center',
  },
  burnButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 8,
  },
});