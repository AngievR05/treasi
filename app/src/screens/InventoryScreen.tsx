import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

export interface CacheItem {
  id: string;
  dbRef: string;
  title: string;
  category: 'cache' | 'ephemera';
  iconSymbol: string;
  coordinates: string;
  status: string;
  hint?: string;
  payloadText?: string;
}

interface InventoryScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

// Initial mock data mirroring your vintage wireframe designs
const INITIAL_CACHES: CacheItem[] = [
  {
    id: '1',
    dbRef: 'CX-0417',
    title: 'OAK HOLLOW',
    category: 'cache',
    iconSymbol: '📍',
    coordinates: "40°45.6'N 122°26.3'W",
    status: 'IN FIELD',
    hint: 'Where the old oak splits the fence, ten steps toward the setting sun...',
    payloadText: 'Secret map marker unlocked.',
  },
  {
    id: '2',
    dbRef: 'CX-0892',
    title: 'FENCE POST',
    category: 'cache',
    iconSymbol: '🎯',
    coordinates: "40°45.9'N 122°25.8'W",
    status: 'IN FIELD',
    hint: 'Behind the third rusted iron latch near the south paddock boundary.',
    payloadText: 'Bronze compass key found.',
  },
  {
    id: '3',
    dbRef: 'CX-1104',
    title: 'RIVER BEND',
    category: 'cache',
    iconSymbol: '🧭',
    coordinates: "40°46.2'N 122°24.1'W",
    status: 'IN FIELD',
    hint: 'Submerged under the flat granite rock near the river bend crossing.',
    payloadText: 'Waterproof cylinder capsule.',
  },
];

const INITIAL_EPHEMERA: CacheItem[] = [
  {
    id: 'e1',
    dbRef: 'EP-1120',
    title: 'BRASS TOKEN',
    category: 'ephemera',
    iconSymbol: '🏆',
    coordinates: "40°46.0'N 122°24.9'W",
    status: 'ARCHIVED',
    payloadText: 'Engraved: "To the brave explorers of 1962."',
  },
  {
    id: 'e2',
    dbRef: 'EP-1121',
    title: 'FIELD NOTE',
    category: 'ephemera',
    iconSymbol: '📖',
    coordinates: "40°45.8'N 122°25.1'W",
    status: 'ARCHIVED',
    payloadText: 'Weathered journal page detailing campus secrets.',
  },
  {
    id: 'e3',
    dbRef: 'EP-1122',
    title: 'OLD PHOTO',
    category: 'ephemera',
    iconSymbol: '📷',
    coordinates: "40°45.5'N 122°26.0'W",
    status: 'ARCHIVED',
    payloadText: 'Monochrome snapshot of the central quad building.',
  },
];

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  onBack,
  onNavigate,
}) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // State Management
  const [activeTab, setActiveTab] = useState<'cache' | 'ephemera'>('cache');
  const [items, setItems] = useState<CacheItem[]>([
    ...INITIAL_CACHES,
    ...INITIAL_EPHEMERA,
  ]);
  const [selectedId, setSelectedId] = useState<string>('1');

  // Creation State (Bury Cache Mode)
  const [isBurying, setIsBurying] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newCoordinates, setNewCoordinates] = useState("40°45.7'N 122°25.5'W");
  const [activeScreen, setActiveScreen] = useState<NavigationTab>('INVENTORY');

  // Filter items based on active tab
  const currentList = items.filter((item) => item.category === activeTab);
  const selectedItem = items.find((item) => item.id === selectedId) || currentList[0];

  const handleNavigate = (screen: string) => {
    setActiveScreen(screen as NavigationTab);
    onNavigate?.(screen);
  };

  // Handler: Add New Cache (CREATE)
  const handleBuryCache = () => {
    if (!newTitle.trim()) {
      Alert.alert('Field Error', 'Please specify a title for your buried cache.');
      return;
    }

    const newCache: CacheItem = {
      id: Date.now().toString(),
      dbRef: `CX-${Math.floor(1000 + Math.random() * 9000)}`,
      title: newTitle.toUpperCase(),
      category: 'cache',
      iconSymbol: '📍',
      coordinates: newCoordinates,
      status: 'IN FIELD',
      hint: newHint || 'No clue provided.',
      payloadText: 'Freshly planted field treasure.',
    };

    setItems((prev) => [newCache, ...prev]);
    setSelectedId(newCache.id);
    setIsBurying(false);
    setNewTitle('');
    setNewHint('');
    Alert.alert('Cache Buried', `[${newCache.title}] anchored at current coordinates.`);
  };

  // Handler: Delete Cache (DELETE)
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
          onPress: () => {
            const updated = items.filter((i) => i.id !== selectedItem.id);
            setItems(updated);
            // Re-select first remaining item if possible
            const remainingTabItems = updated.filter((i) => i.category === activeTab);
            if (remainingTabItems.length > 0) {
              setSelectedId(remainingTabItems[0].id);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.splitWrapper}>
        
        {/* ========================================== */}
        {/* LEFT VIEWPORT (60% OPERATIONAL PARCHMENT) */}
        {/* ========================================== */}
        <View style={styles.leftViewport}>
          
          {/* Top Category Tabs */}
          <View style={styles.tabHeaderRow}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'cache' ? styles.tabActive : styles.tabInactive,
              ]}
              onPress={() => {
                setActiveTab('cache');
                setIsBurying(false);
                const firstCache = items.find((i) => i.category === 'cache');
                if (firstCache) setSelectedId(firstCache.id);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'cache'
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                MY ACTIVE CACHES
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
                const firstEphem = items.find((i) => i.category === 'ephemera');
                if (firstEphem) setSelectedId(firstEphem.id);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'ephemera'
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                COLLECTED EPHEMERA
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sub-Header / Bury Trigger */}
          <View style={styles.leftSubHeader}>
            <Text style={styles.sectionTitle}>
              {isBurying
                ? '★ FABRICATE & BURY NEW CACHE'
                : activeTab === 'cache'
                ? 'FIELD BAG (PLANTED)'
                : 'DISCOVERED ARTIFACTS'}
            </Text>
            {activeTab === 'cache' && (
              <TouchableOpacity
                style={styles.buryToggleButton}
                onPress={() => setIsBurying(!isBurying)}
              >
                <Text style={styles.buryToggleText}>
                  {isBurying ? '‹ CANCEL' : '+ BURY NEW CACHE'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Dynamic Content Area: Form OR Grid */}
          {isBurying ? (
            /* BURY CACHE FORM (CREATE OPERATION) */
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

              <Text style={styles.label}>GPS COORDINATES (AUTO-LOCKED)</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={newCoordinates}
                editable={false}
              />

              <Text style={styles.label}>CLUE / RIDDLE HINT</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Enter secret clue for hunters..."
                placeholderTextColor="#A09580"
                multiline
                numberOfLines={3}
                value={newHint}
                onChangeText={setNewHint}
              />

              <TouchableOpacity
                style={styles.sealAndBuryBtn}
                onPress={handleBuryCache}
              >
                <Text style={styles.sealAndBuryText}>SEAL & BURY CACHE</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* ITEM GRID (READ OPERATION) */
            <ScrollView contentContainerStyle={styles.gridContainer}>
              <View style={styles.grid}>
                {currentList.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.itemCard,
                        isSelected && styles.itemCardSelected,
                      ]}
                      onPress={() => setSelectedId(item.id)}
                    >
                      <Text style={styles.itemIcon}>{item.iconSymbol}</Text>
                      <Text style={styles.itemText} numberOfLines={1}>
                        {item.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {currentList.length === 0 && (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                      No field records logged.
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </View>

        {/* ========================================== */}
        {/* RIGHT VIEWPORT (40% FOREST GREEN CONSOLE) */}
        {/* ========================================== */}
        <View style={styles.rightViewport}>
          <View style={styles.telemetryPanel}>
            <Text style={styles.panelTitle}>★ INSPECTION DETAIL</Text>
            <View style={styles.divider} />

            {selectedItem ? (
              <View style={styles.detailsBody}>
                <View style={styles.iconCircle}>
                  <Text style={styles.largeIcon}>{selectedItem.iconSymbol}</Text>
                </View>

                <Text style={styles.itemHeaderTitle}>{selectedItem.title}</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>DB REF ID</Text>
                  <Text style={styles.metaValue}>{selectedItem.dbRef}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>COORDINATES</Text>
                  <Text style={styles.metaValue}>{selectedItem.coordinates}</Text>
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
              </View>
            ) : (
              <View style={styles.detailsBody}>
                <Text style={styles.metaLabel}>No items selected for inspection.</Text>
              </View>
            )}

            {/* DELETE CTA BUTTON */}
            {selectedItem && (
              <TouchableOpacity
                style={styles.burnButton}
                onPress={handleBurnEvidence}
              >
                <Text style={styles.burnButtonText}>
                  🔥 BURN EVIDENCE / ERASE CACHE
                </Text>
              </TouchableOpacity>
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

/* ========================================== */
/* SKEUOMORPHIC VINTAGE STYLESHEET            */
/* ========================================== */
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
    backgroundColor: '#E8DCC0', // Parchment
    padding: 16,
    borderRightWidth: 3,
    borderColor: '#B08D57', // Brass Trim
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
    backgroundColor: '#A64B2A', // Sienna Accent
  },
  tabInactive: {
    backgroundColor: '#F3ECD8', // Secondary Parchment
  },
  tabText: {
    fontSize: 11,
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 0.5,
  },
  buryToggleButton: {
    backgroundColor: '#2C3B2E',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  buryToggleText: {
    color: '#E8DCC0',
    fontSize: 10,
    fontWeight: 'bold',
  },

  /* ITEM GRID STYLES */
  gridContainer: {
    paddingBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  itemCard: {
    width: 105,
    height: 95,
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
  itemIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  itemText: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#8A7E6B',
    fontSize: 12,
    fontStyle: 'italic',
  },

  /* FORM STYLES (BURY CACHE) */
  formContainer: {
    backgroundColor: '#F3ECD8',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 12,
  },
  label: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#2A2420',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: '#2A2420',
  },
  inputDisabled: {
    opacity: 0.7,
    backgroundColor: '#D9C8A9',
  },
  textArea: {
    height: 50,
    textAlignVertical: 'top',
  },
  sealAndBuryBtn: {
    backgroundColor: '#A64B2A',
    paddingVertical: 10,
    borderRadius: 3,
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  sealAndBuryText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 1,
  },

  /* RIGHT 40% CONTROL VIEWPORT */
  rightViewport: {
    flex: 0.4,
    backgroundColor: '#2C3B2E', // Forest Deep
    padding: 12,
    justifyContent: 'space-between',
  },
  telemetryPanel: {
    flex: 1,
  },
  panelTitle: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 1,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#B08D57',
    marginBottom: 10,
  },
  detailsBody: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1C2A20',
    borderWidth: 1,
    borderColor: '#B08D57',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  largeIcon: {
    fontSize: 22,
  },
  itemHeaderTitle: {
    color: '#E8DCC0',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#3A4B3C',
    paddingBottom: 3,
  },
  metaLabel: {
    color: '#B08D57',
    fontSize: 10,
    fontWeight: 'bold',
  },
  metaValue: {
    color: '#E8DCC0',
    fontSize: 10,
    fontFamily: 'Courier',
  },
  hintBox: {
    marginTop: 8,
    backgroundColor: '#1C2A20',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    width: '100%',
  },
  hintLabel: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  hintText: {
    color: '#E8DCC0',
    fontSize: 10,
    fontStyle: 'italic',
  },
  burnButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 10,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
  },
  burnButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
});