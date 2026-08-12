import React, { useState, useEffect } from 'react';
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
} from 'lucide-react-native';
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
  orderBy,
} from 'firebase/firestore';

// Core Application References
import { db, auth } from '../config/firebase';
import { TreasureDocument, DiscoveryDocument } from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

export type IconType = 'map-pin' | 'target' | 'compass' | 'trophy' | 'book' | 'camera';

export interface DisplayItem {
  id: string;
  dbRef: string;
  title: string;
  category: 'cache' | 'ephemera';
  iconType: IconType;
  coordinates: string;
  status: string;
  hint?: string;
  payloadText?: string;
  creatorName?: string;
}

interface InventoryScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

// Vector Icon Renderer (No Raw Emojis)
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
  onBack,
  onNavigate,
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  // Tab & Screen Navigation
  const [activeTab, setActiveTab] = useState<'cache' | 'ephemera'>('cache');
  const [activeScreen, setActiveScreen] = useState<NavigationTab>('INVENTORY');

  // Real-Time Firestore State
  const [activeCaches, setActiveCaches] = useState<DisplayItem[]>([]);
  const [ephemeraList, setEphemeraList] = useState<DisplayItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form State (Bury Cache Mode - CREATE)
  const [isBurying, setIsBurying] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newPayload, setNewPayload] = useState('');
  const [newLat, setNewLat] = useState('-25.7479');
  const [newLng, setNewLng] = useState('28.2293');

  const currentUserId = auth.currentUser?.uid;

  // 1. Live Firestore Listener: Active Caches Created By Current User (READ)
  useEffect(() => {
    if (!currentUserId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const treasuresRef = collection(db, 'treasures');
    const q = query(
      treasuresRef,
      where('creatorId', '==', currentUserId),
      where('isArchived', '==', false)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loadedCaches: DisplayItem[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as TreasureDocument;
          const latStr = data.location ? data.location.latitude.toFixed(4) : '0.0000';
          const lngStr = data.location ? data.location.longitude.toFixed(4) : '0.0000';

          return {
            id: docSnap.id,
            dbRef: `CX-${docSnap.id.substring(0, 4).toUpperCase()}`,
            title: data.title || 'UNNAMED CACHE',
            category: 'cache',
            iconType: 'map-pin',
            coordinates: `${latStr}°S ${lngStr}°E`,
            status: 'IN FIELD',
            hint: data.hint,
            payloadText: data.payloadText,
            creatorName: data.creatorName,
          };
        });

        setActiveCaches(loadedCaches);
        if (activeTab === 'cache' && loadedCaches.length > 0 && !selectedId) {
          setSelectedId(loadedCaches[0].id);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('Firestore active treasures subscription error:', error);
        Alert.alert('Telemetry Sync Error', 'Failed to retrieve active caches from Firestore.');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUserId, activeTab]);

  // 2. Live Firestore Listener: Discovered Ephemera (READ)
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

        // Fetch corresponding unlocked treasure records
        const treasuresRef = collection(db, 'treasures');
        const treasuresUnsub = onSnapshot(treasuresRef, (tSnapshot) => {
          const unlockedItems: DisplayItem[] = tSnapshot.docs
            .filter((tDoc) => discoveryDocIds.includes(tDoc.id))
            .map((tDoc) => {
              const data = tDoc.data() as TreasureDocument;
              const latStr = data.location ? data.location.latitude.toFixed(4) : '0.0000';
              const lngStr = data.location ? data.location.longitude.toFixed(4) : '0.0000';

              return {
                id: tDoc.id,
                dbRef: `EP-${tDoc.id.substring(0, 4).toUpperCase()}`,
                title: data.title || 'UNEARTHED ARTIFACT',
                category: 'ephemera',
                iconType: 'trophy',
                coordinates: `${latStr}°S ${lngStr}°E`,
                status: 'EXCAVATED',
                hint: data.hint,
                payloadText: data.payloadText,
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
        console.error('Firestore discoveries subscription error:', error);
      }
    );

    return () => unsubscribe();
  }, [currentUserId, activeTab]);

  // Active Item Selection Derived State
  const currentList = activeTab === 'cache' ? activeCaches : ephemeraList;
  const selectedItem =
    currentList.find((item) => item.id === selectedId) ||
    (currentList.length > 0 ? currentList[0] : null);

  const handleNavigate = (screen: string) => {
    setActiveScreen(screen as NavigationTab);
    onNavigate?.(screen);
  };

  // Handler: Bury New Cache (CREATE OPERATION)
  const handleBuryCache = async () => {
    if (!currentUserId) {
      Alert.alert('Authentication Error', 'No active Explorer session detected.');
      return;
    }

    if (!newTitle.trim()) {
      Alert.alert('Field Error', 'Please specify a title for your buried cache.');
      return;
    }

    try {
      setIsSubmitting(true);
      const lat = parseFloat(newLat) || -25.7479;
      const lng = parseFloat(newLng) || 28.2293;

      const newTreasure: Omit<TreasureDocument, 'treasureId'> = {
        creatorId: currentUserId,
        creatorName: auth.currentUser?.displayName || 'Unknown Explorer',
        title: newTitle.trim().toUpperCase(),
        hint: newHint.trim() || 'No explicit clue provided for this cache.',
        payloadText: newPayload.trim() || 'Secret field payload recorded.',
        location: new GeoPoint(lat, lng),
        isArchived: false,
        createdAt: serverTimestamp() as any,
      };

      const docRef = await addDoc(collection(db, 'treasures'), newTreasure);

      setIsBurying(false);
      setNewTitle('');
      setNewHint('');
      setNewPayload('');
      setSelectedId(docRef.id);
      Alert.alert('Cache Anchored', `[${newTitle.toUpperCase()}] sealed into Firestore registry.`);
    } catch (error: any) {
      console.error('Error creating treasure:', error);
      Alert.alert('Fabrication Failed', error?.message || 'Could not save cache to remote database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handler: Burn Evidence / Soft Delete (UPDATE / DELETE OPERATION)
  const handleBurnEvidence = () => {
    if (!selectedItem) return;

    Alert.alert(
      'Burn Evidence',
      `Are you sure you want to permanently erase "${selectedItem.title}" from the field records?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              // Perform soft-delete by setting isArchived to true (enforced by Security Rules)
              const treasureDocRef = doc(db, 'treasures', selectedItem.id);
              await updateDoc(treasureDocRef, {
                isArchived: true,
              });

              setSelectedId(null);
              Alert.alert('Record Expunged', 'Cache successfully archived in remote registry.');
            } catch (error: any) {
              console.error('Error erasing cache:', error);
              Alert.alert('Erasure Failed', error?.message || 'Failed to update remote document status.');
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
          {/* Top Navigation Tabs */}
          <View style={styles.tabHeaderRow}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'cache' ? styles.tabActive : styles.tabInactive,
              ]}
              onPress={() => {
                setActiveTab('cache');
                setIsBurying(false);
                if (activeCaches.length > 0) setSelectedId(activeCaches[0].id);
              }}
              accessible={true}
              accessibilityRole="tab"
              accessibilityLabel="My Active Caches Tab"
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'cache' ? styles.tabTextActive : styles.tabTextInactive,
                ]}
              >
                MY ACTIVE CACHES ({activeCaches.length})
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

          {/* Sub-Header & Bury Cache Trigger */}
          <View style={styles.leftSubHeader}>
            <View style={styles.sectionHeaderRow}>
              <FileSearch size={14} color="#2A2420" style={styles.titleIcon} />
              <Text style={styles.sectionTitle}>
                {isBurying
                  ? 'FABRICATE & BURY NEW CACHE'
                  : activeTab === 'cache'
                  ? 'FIELD BAG (PLANTED)'
                  : 'DISCOVERED ARTIFACTS'}
              </Text>
            </View>

            {activeTab === 'cache' && (
              <TouchableOpacity
                style={styles.buryToggleButton}
                onPress={() => setIsBurying(!isBurying)}
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

          {/* Dynamic Content View: Form OR Grid */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#A64B2A" />
              <Text style={styles.loadingText}>POLLING FIRESTORE TELEMETRY...</Text>
            </View>
          ) : isBurying ? (
            /* BURY CACHE FORM (CREATE) */
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={{ flex: 1 }}
            >
              <ScrollView
                style={styles.formContainer}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                <Text style={styles.label}>CACHE TITLE / LOCATION NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., OLD WINDMILL CREST"
                  placeholderTextColor="#A09580"
                  value={newTitle}
                  onChangeText={setNewTitle}
                />

                <Text style={styles.label}>CLUE / RIDDLE HINT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter secret clue for hunters..."
                  placeholderTextColor="#A09580"
                  multiline
                  numberOfLines={2}
                  value={newHint}
                  onChangeText={setNewHint}
                />

                <Text style={styles.label}>SECRET PAYLOAD CONTENT</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Text revealed upon extraction..."
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
            /* ITEM GRID (READ) */
            <ScrollView contentContainerStyle={styles.gridContainer}>
              <Animated.View layout={Layout.springify()} style={styles.grid}>
                {currentList.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <AnimatedTouchableOpacity
                      key={item.id}
                      style={[
                        styles.itemCard,
                        isSelected && styles.itemCardSelected,
                      ]}
                      onPress={() => setSelectedId(item.id)}
                      accessibilityLabel={`Select item ${item.title}`}
                    >
                      <View style={styles.iconWrapper}>
                        <ItemIcon
                          type={item.iconType}
                          size={24}
                          color={isSelected ? '#A64B2A' : '#2A2420'}
                        />
                      </View>
                      <Text style={styles.itemText} numberOfLines={1}>
                        {item.title}
                      </Text>
                    </AnimatedTouchableOpacity>
                  );
                })}

                {currentList.length === 0 && (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                      No remote field records logged in Firestore.
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
              <Text style={styles.panelTitle}>INSPECTION DETAIL</Text>
            </View>
            <View style={styles.divider} />

            {selectedItem ? (
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
                  <Text style={styles.metaLabel}>FIRESTORE ID</Text>
                  <Text style={styles.metaValue}>{selectedItem.dbRef}</Text>
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
                  <View style={[styles.hintBox, { marginTop: 6 }]}>
                    <Text style={styles.hintLabel}>UNLOCKED PAYLOAD:</Text>
                    <Text style={styles.hintText}>{selectedItem.payloadText}</Text>
                  </View>
                )}
              </Animated.View>
            ) : (
              <View style={styles.detailsBody}>
                <Text style={styles.noSelectionText}>
                  No active item selected for telemetry analysis.
                </Text>
              </View>
            )}

            {/* ERASE / SOFT-DELETE CTA */}
            {selectedItem && activeTab === 'cache' && (
              <AnimatedTouchableOpacity
                style={styles.burnButton}
                onPress={handleBurnEvidence}
                accessibilityLabel="Burn Evidence and Erase Cache"
              >
                <View style={styles.burnBtnInner}>
                  <Flame size={14} color="#F3ECD8" />
                  <Text style={styles.burnButtonText}>
                    BURN EVIDENCE / ERASE CACHE
                  </Text>
                </View>
              </AnimatedTouchableOpacity>
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
    padding: 16,
    borderRightWidth: 3,
    borderColor: '#B08D57',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
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
    fontSize: 10,
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
    marginBottom: 12,
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
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 0.5,
  },
  buryToggleButton: {
    backgroundColor: '#2C3B2E',
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    fontSize: 9,
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
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  gridContainer: {
    paddingBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  itemCard: {
    width: 100,
    height: 90,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  itemCardSelected: {
    backgroundColor: '#D9C8A9',
    borderWidth: 2,
    borderColor: '#A64B2A',
  },
  iconWrapper: {
    marginBottom: 4,
  },
  itemText: {
    color: '#2A2420',
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
    width: '100%',
  },
  emptyText: {
    color: '#8A7E6B',
    fontSize: 11,
    fontStyle: 'italic',
  },

  /* FORM STYLES (BURY CACHE) */
  formContainer: {
    backgroundColor: '#F3ECD8',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 10,
  },
  label: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#2A2420',
    marginBottom: 2,
    marginTop: 6,
  },
  input: {
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    color: '#2A2420',
  },
  textArea: {
    height: 40,
    textAlignVertical: 'top',
  },
  coordsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sealAndBuryBtn: {
    backgroundColor: '#A64B2A',
    paddingVertical: 10,
    borderRadius: 3,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  sealAndBuryText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
  },

  /* RIGHT 40% CONTROL VIEWPORT */
  rightViewport: {
    flex: 0.4,
    backgroundColor: '#2C3B2E',
    padding: 12,
    justifyContent: 'space-between',
  },
  telemetryPanel: {
    flex: 1,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  panelTitle: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#B08D57',
    marginBottom: 8,
  },
  detailsBody: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1C2A20',
    borderWidth: 1,
    borderColor: '#B08D57',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemHeaderTitle: {
    color: '#E8DCC0',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#3A4B3C',
    paddingBottom: 2,
  },
  metaLabel: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
  },
  metaValue: {
    color: '#E8DCC0',
    fontSize: 9,
    fontFamily: 'Courier',
  },
  noSelectionText: {
    color: '#B08D57',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 20,
  },
  hintBox: {
    marginTop: 6,
    backgroundColor: '#1C2A20',
    padding: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    width: '100%',
  },
  hintLabel: {
    color: '#B08D57',
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  hintText: {
    color: '#E8DCC0',
    fontSize: 9,
    fontStyle: 'italic',
  },
  burnButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 8,
  },
  burnBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  burnButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
});