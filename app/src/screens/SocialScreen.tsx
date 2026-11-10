import { useKeyboardEditing } from '../hooks/useKeyboardEditing';
import { KeyboardEditingBar } from '../components/KeyboardEditingBar';
import { FormScrollView, FormTextInput } from '../components/FormScrollView';
import { useAuthenticatedUser, useAccountSession } from '../hooks/useAccountSession';
import { isFreshLocation, useDashboardLocation } from '../hooks/useDashboardLocation';
import type { User } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useRef, useState, } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons, } from '@expo/vector-icons';
import { collection, deleteField, doc, GeoPoint, getDocs, limit, orderBy, runTransaction, query, serverTimestamp, where, writeBatch, type Timestamp, } from 'firebase/firestore';
import { db, } from '../config/firebase';
import { FieldNavBar, type NavigationTab, } from '../components/FieldNavBar';
import type { FriendshipDocument, FriendshipStatus, MessageDocument, UserDocument, } from '../types/firestore';
interface UserCoordinates {
    latitude: number;
    longitude: number;
}
interface DirectoryExplorer {
    uid: string;
    name: string;
    initial: string;
    telemetryEnabled: boolean;
    location: UserCoordinates | null;
}
interface FriendshipMeta {
    docId: string;
    targetUid: string;
    status: FriendshipStatus;
    isRequester: boolean;
}
interface NearbyExplorer {
    uid: string;
    name: string;
    initial: string;
    distanceKm: number;
    distanceFormatted: string;
    friendMeta?: FriendshipMeta;
}
interface GlobalDispatch {
    messageId: string;
    senderId: string;
    senderName: string;
    text: string;
    createdAt: Timestamp | null;
}
interface FriendshipErrors {
    outgoing: string | null;
    incoming: string | null;
}
type SocialLocationStatus = 'CHECKING' | 'READY' | 'PERMISSION_REQUIRED' | 'DENIED' | 'SERVICES_OFF' | 'ERROR';
interface Props {
    onNavigate?: (tab: string) => void;
    userCoordinates?: UserCoordinates | null;
}
const RADIUS_KM = 20;
const MAX_EXPLORERS = 100;
const MAX_GLOBAL_MESSAGES = 40;
const MAX_TELEGRAM_LENGTH = 500;
const MAX_CALLSIGN_LENGTH = 24;
const LOCATION_PUBLISH_DISTANCE_KM = 0.02;
const COLOURS = {
    forest950: '#172018',
    forest900: '#1C261D',
    forest800: '#2C3B2E',
    forest700: '#3D503F',
    parchment100: '#F6EFD9',
    parchment200: '#E8DCC0',
    ink900: '#2A2420',
    ink700: '#514A40',
    bronze700: '#5F4B32',
    bronze600: '#6B563A',
    bronze500: '#B08D57',
    bronze400: '#C3A06A',
    rust800: '#71301C',
    rust700: '#7F321B',
    rust600: '#8C3A20',
    success700: '#3E6546',
    success300: '#BFE3C0',
    warning300: '#E6C580',
    danger300: '#FFB4A2',
    white: '#FFFFFF',
    overlay: 'rgba(10, 16, 11, 0.86)',
} as const;
const MONO_FONT = Platform.OS === 'ios'
    ? 'Courier'
    : 'monospace';
const MONO_BOLD_FONT = Platform.OS === 'ios'
    ? 'Courier-Bold'
    : 'monospace';
const logDevelopmentWarning = (message: string, error?: unknown): void => {
    if (__DEV__) {
        console.warn(message, error ?? '');
    }
};
const isValidCoordinate = (latitude: unknown, longitude: unknown): boolean => typeof latitude ===
    'number' &&
    typeof longitude ===
        'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
const extractCoordinates = (value: unknown): UserCoordinates | null => {
    if (!value ||
        typeof value !==
            'object' ||
        !('latitude' in value) ||
        !('longitude' in value)) {
        return null;
    }
    const latitude = value.latitude;
    const longitude = value.longitude;
    if (!isValidCoordinate(latitude, longitude)) {
        return null;
    }
    return {
        latitude: latitude as number,
        longitude: longitude as number,
    };
};
const calculateHaversineDistanceKm = (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number => {
    const earthRadiusKm = 6371;
    const latitudeDifference = ((latitudeB -
        latitudeA) *
        Math.PI) /
        180;
    const longitudeDifference = ((longitudeB -
        longitudeA) *
        Math.PI) /
        180;
    const a = Math.sin(latitudeDifference /
        2) **
        2 +
        Math.cos((latitudeA *
            Math.PI) /
            180) *
            Math.cos((latitudeB *
                Math.PI) /
                180) *
            Math.sin(longitudeDifference /
                2) **
                2;
    return (earthRadiusKm *
        (2 *
            Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)))));
};
const formatDistance = (distanceKm: number): string => {
    if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)} M`;
    }
    return `${distanceKm.toFixed(1)} KM`;
};
const normaliseName = (value: unknown, fallback = 'EXPLORER'): string => {
    const name = typeof value ===
        'string'
        ? value.trim()
        : '';
    return name
        ? name.toUpperCase()
        : fallback;
};
const getDeterministicFriendshipId = (uidA: string, uidB: string): string => [
    uidA,
    uidB,
]
    .sort()
    .join('_');
const isFriendshipStatus = (value: unknown): value is FriendshipStatus => value ===
    'pending' ||
    value ===
        'accepted' ||
    value ===
        'declined' ||
    value ===
        'blocked';
const safeTimestamp = (value: Timestamp | null): number => {
    try { const time = value?.toMillis(); return typeof time === 'number' && Number.isFinite(time) ? time : 0; } catch { return 0; }
};
const formatRelativeTime = (timestamp: Timestamp | null): string => {
    if (!timestamp) {
        return 'JUST NOW';
    }
    try {
        const differenceSeconds = Math.max(0, Math.floor((Date.now() -
            safeTimestamp(timestamp)) /
            1000));
        if (differenceSeconds <
            60) {
            return 'JUST NOW';
        }
        if (differenceSeconds <
            3600) {
            return `${Math.floor(differenceSeconds /
                60)}M AGO`;
        }
        if (differenceSeconds <
            86400) {
            return `${Math.floor(differenceSeconds /
                3600)}H AGO`;
        }
        return `${Math.floor(differenceSeconds /
            86400)}D AGO`;
    }
    catch {
        return 'RECENT';
    }
};
const showAccessibleAlert = (title: string, message: string): void => {
    AccessibilityInfo
        .announceForAccessibility(`${title}. ${message}`);
    Alert.alert(title, message);
};
export const SocialScreen: React.FC<Props> = props => {
    const user = useAuthenticatedUser();
    return <SocialContent key={user?.uid ?? 'signed-out'} {...props} currentUser={user} />;
};
const SocialContent: React.FC<Props & { currentUser: User | null }> = ({ onNavigate, currentUser }) => {
    const keyboardVisible = useKeyboardEditing();

    const { width, height, } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const isLandscape = width > height;
    const currentTab: NavigationTab = 'LEADERBOARD';
    const currentUserId = currentUser?.uid ??
        '';
    const { isCurrent, onSnapshot } = useAccountSession(currentUserId);
    const friendLockRef = useRef(false);
    const searchLockRef = useRef(false);
    const telegramLockRef = useRef(false);
    const lastPublishedLocationRef = useRef<string | null>(null);
    const isPublishingLocationRef = useRef(false);
    const [reduceMotionEnabled, setReduceMotionEnabled,] = useState(false);
    const [currentUserProfile, setCurrentUserProfile,] = useState<UserDocument | null>(null);
    const [profileError, setProfileError,] = useState<string | null>(null);
    const [allUsers, setAllUsers,] = useState<DirectoryExplorer[]>([]);
    const [loadingExplorers, setLoadingExplorers,] = useState(true);
    const [explorerError, setExplorerError,] = useState<string | null>(null);
    const [outgoingFriendships, setOutgoingFriendships,] = useState<FriendshipMeta[]>([]);
    const [incomingFriendships, setIncomingFriendships,] = useState<FriendshipMeta[]>([]);
    const [friendshipErrors, setFriendshipErrors,] = useState<FriendshipErrors>({
        outgoing: null,
        incoming: null,
    });
    const [actionUid, setActionUid,] = useState<string | null>(null);
    const [telegramText, setTelegramText,] = useState('');
    const [globalDispatches, setGlobalDispatches,] = useState<GlobalDispatch[]>([]);
    const [loadingDispatches, setLoadingDispatches,] = useState(true);
    const [telegramError, setTelegramError,] = useState<string | null>(null);
    const [isTransmitting, setIsTransmitting,] = useState(false);
    const gps = useDashboardLocation(currentUserProfile?.batteryOptimizerEnabled === true);
    const { locationPermissionStatus, canAskLocationAgain, locationServicesEnabled } = gps;
    const livePosition = gps.userLocation && gps.locationFixSource === 'live' &&
        !gps.locationError && isFreshLocation(gps.userLocation) ? gps.userLocation : null;
    const latitude = livePosition?.coords.latitude;
    const longitude = livePosition?.coords.longitude;
    const currentCoordinates = useMemo(() => latitude != null && longitude != null ? { latitude, longitude } : null, [latitude, longitude]);
    const locationStatus: SocialLocationStatus = gps.isInitialisingLocation ? 'CHECKING' :
        locationPermissionStatus === 'undetermined' ? 'PERMISSION_REQUIRED' :
        locationPermissionStatus === 'denied' ? 'DENIED' :
        locationServicesEnabled === false ? 'SERVICES_OFF' :
        livePosition ? 'READY' : 'ERROR';
    const refreshCurrentLocation = gps.startLocationService;
    const [locationPublishError, setLocationPublishError,] = useState<string | null>(null);
    const [friendModalVisible, setFriendModalVisible,] = useState(false);
    const [searchAgentTag, setSearchAgentTag,] = useState('');
    const [searchError, setSearchError,] = useState<string | null>(null);
    const [isSearching, setIsSearching,] = useState(false);
    const [retryKey, setRetryKey,] = useState(0);
    useEffect(() => {
        let mounted = true;
        AccessibilityInfo
            .isReduceMotionEnabled()
            .then((enabled) => {
            if (mounted) {
                setReduceMotionEnabled(enabled);
            }
        })
            .catch(() => {
        });
        const subscription = AccessibilityInfo
            .addEventListener('reduceMotionChanged', setReduceMotionEnabled);
        return () => {
            mounted =
                false;
            subscription.remove();
        };
    }, []);
    useEffect(() => {
        if (!currentUserId) {
            setCurrentUserProfile(null);
            setProfileError('EXPLORER SESSION REQUIRED');
            return;
        }
        setProfileError(null);
        const reference = doc(db, 'users', currentUserId);
        const unsubscribe = onSnapshot(reference, (snapshot) => {
            if (snapshot.exists()) {
                setCurrentUserProfile(snapshot.data() as UserDocument);
                setProfileError(null);
            }
            else {
                setCurrentUserProfile(null);
                setProfileError('EXPLORER PROFILE NOT FOUND');
            }
        }, (error) => {
            logDevelopmentWarning('[Treasi Social] Profile subscription failed:', error);
            setProfileError('EXPLORER PROFILE SYNC OFFLINE');
        });
        return unsubscribe;
    }, [
        currentUserId,
        retryKey,
        onSnapshot,
    ]);
    useEffect(() => {
        if (!currentUserId) {
            setAllUsers([]);
            setLoadingExplorers(false);
            return;
        }
        setLoadingExplorers(true);
        setExplorerError(null);
        const usersQuery = query(collection(db, 'users'), limit(MAX_EXPLORERS));
        const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
            const users: DirectoryExplorer[] = snapshot.docs
                .filter((documentSnapshot) => documentSnapshot.id !==
                currentUserId)
                .map((documentSnapshot) => {
                const data = documentSnapshot.data() as UserDocument;
                const name = normaliseName(data.username);
                return {
                    uid: documentSnapshot.id,
                    name,
                    initial: name.charAt(0) ||
                        'E',
                    telemetryEnabled: data.telemetryEnabled ===
                        true,
                    location: extractCoordinates(data.location),
                };
            });
            setAllUsers(users);
            setExplorerError(null);
            setLoadingExplorers(false);
        }, (error) => {
            logDevelopmentWarning('[Treasi Social] Explorer directory subscription failed:', error);
            setExplorerError('EXPLORER DIRECTORY SYNC OFFLINE');
            setLoadingExplorers(false);
        });
        return unsubscribe;
    }, [
        currentUserId,
        retryKey,
        onSnapshot,
    ]);
    useEffect(() => {
        if (!currentUserId) {
            setOutgoingFriendships([]);
            setIncomingFriendships([]);
            return;
        }
        setFriendshipErrors({
            outgoing: null,
            incoming: null,
        });
        const outgoingQuery = query(collection(db, 'friendships'), where('requesterId', '==', currentUserId));
        const incomingQuery = query(collection(db, 'friendships'), where('receiverId', '==', currentUserId));
        const unsubscribeOutgoing = onSnapshot(outgoingQuery, (snapshot) => {
            const relationships = snapshot.docs
                .map((documentSnapshot): FriendshipMeta | null => {
                const data = documentSnapshot.data() as Partial<FriendshipDocument>;
                if (data.requesterId !== currentUserId || data.receiverId === currentUserId || typeof data.receiverId !==
                    'string' || !data.receiverId.trim() || data.receiverId.includes('/') ||
                    !isFriendshipStatus(data.status)) {
                    return null;
                }
                return {
                    docId: documentSnapshot.id,
                    targetUid: data.receiverId,
                    status: data.status,
                    isRequester: true,
                };
            })
                .filter((item): item is FriendshipMeta => item !==
                null);
            setOutgoingFriendships(relationships);
            setFriendshipErrors((current) => ({
                ...current,
                outgoing: null,
            }));
        }, (error) => {
            logDevelopmentWarning('[Treasi Social] Outgoing friendship subscription failed:', error);
            setFriendshipErrors((current) => ({
                ...current,
                outgoing: 'OUTGOING LINK SYNC OFFLINE',
            }));
        });
        const unsubscribeIncoming = onSnapshot(incomingQuery, (snapshot) => {
            const relationships = snapshot.docs
                .map((documentSnapshot): FriendshipMeta | null => {
                const data = documentSnapshot.data() as Partial<FriendshipDocument>;
                if (data.receiverId !== currentUserId || data.requesterId === currentUserId || typeof data.requesterId !==
                    'string' || !data.requesterId.trim() || data.requesterId.includes('/') ||
                    !isFriendshipStatus(data.status)) {
                    return null;
                }
                return {
                    docId: documentSnapshot.id,
                    targetUid: data.requesterId,
                    status: data.status,
                    isRequester: false,
                };
            })
                .filter((item): item is FriendshipMeta => item !==
                null);
            setIncomingFriendships(relationships);
            setFriendshipErrors((current) => ({
                ...current,
                incoming: null,
            }));
        }, (error) => {
            logDevelopmentWarning('[Treasi Social] Incoming friendship subscription failed:', error);
            setFriendshipErrors((current) => ({
                ...current,
                incoming: 'INCOMING LINK SYNC OFFLINE',
            }));
        });
        return () => {
            unsubscribeOutgoing();
            unsubscribeIncoming();
        };
    }, [
        currentUserId,
        retryKey,
        onSnapshot,
    ]);
    useEffect(() => {
        if (!currentUserId) {
            setGlobalDispatches([]);
            setLoadingDispatches(false);
            return;
        }
        setLoadingDispatches(true);
        setTelegramError(null);
        const messagesQuery = query(collection(db, 'messages'), where('type', '==', 'GLOBAL_DISPATCH'), orderBy('createdAt', 'desc'), limit(MAX_GLOBAL_MESSAGES));
        const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
            const dispatches: GlobalDispatch[] = snapshot.docs
                .map((documentSnapshot) => {
                const data = documentSnapshot.data() as MessageDocument;
                const senderName = normaliseName(data.senderName);
                const text = typeof data.text ===
                    'string'
                    ? data.text.trim()
                    : '';
                const createdAt = data.createdAt &&
                    typeof data.createdAt.toMillis === 'function' && Number.isFinite(safeTimestamp(data.createdAt))
                    ? data.createdAt
                    : null;
                return {
                    messageId: documentSnapshot.id,
                    senderId: typeof data.senderId ===
                        'string'
                        ? data.senderId
                        : '',
                    senderName,
                    text,
                    createdAt,
                };
            })
                .filter((dispatch) => Boolean(dispatch.senderId) &&
                Boolean(dispatch.text))
                .sort((itemA, itemB) => {
                return safeTimestamp(itemB.createdAt) - safeTimestamp(itemA.createdAt);
            });
            setGlobalDispatches(dispatches);
            setTelegramError(null);
            setLoadingDispatches(false);
        }, (error) => {
            logDevelopmentWarning('[Treasi Social] Telegram subscription failed:', error);
            setTelegramError(error.code === 'failed-precondition' ? 'TELEGRAM FEED INDEX REQUIRED' : 'TELEGRAM FEED SYNC OFFLINE');
            setLoadingDispatches(false);
        });
        return unsubscribe;
    }, [
        currentUserId,
        retryKey,
        onSnapshot,
    ]);
    const friendshipsMap = useMemo<Record<string, FriendshipMeta>>(() => {
        const map: Record<string, FriendshipMeta> = Object.create(null);
        for (const friendship of outgoingFriendships) {
            map[friendship.targetUid] =
                friendship;
        }
        for (const friendship of incomingFriendships) {
            const existing = map[friendship.targetUid];
            if (!existing ||
                (existing.status !==
                    'accepted' &&
                    friendship.status ===
                        'accepted')) {
                map[friendship.targetUid] =
                    friendship;
            }
        }
        return map;
    }, [
        incomingFriendships,
        outgoingFriendships,
    ]);
    const usersById = useMemo<Record<string, DirectoryExplorer>>(() => {
        const map: Record<string, DirectoryExplorer> = Object.create(null);
        for (const explorer of allUsers) {
            map[explorer.uid] =
                explorer;
        }
        return map;
    }, [
        allUsers,
    ]);
    const incomingRequests = useMemo(() => incomingFriendships
        .filter((friendship) => friendship.status ===
        'pending')
        .map((friendship) => ({
        friendship,
        explorer: usersById[friendship.targetUid],
    })), [
        incomingFriendships,
        usersById,
    ]);
    const acceptedLinks = useMemo(() => {
        const accepted = [
            ...outgoingFriendships,
            ...incomingFriendships,
        ].filter((friendship) => friendship.status ===
            'accepted');
        const seen = new Set<string>();
        return accepted
            .filter((friendship) => {
            if (seen.has(friendship.targetUid)) {
                return false;
            }
            seen.add(friendship.targetUid);
            return true;
        })
            .map((friendship) => ({
            friendship,
            explorer: usersById[friendship.targetUid],
        }));
    }, [
        incomingFriendships,
        outgoingFriendships,
        usersById,
    ]);
    const nearbyExplorers = useMemo<NearbyExplorer[]>(() => {
        if (!currentCoordinates ||
            !isValidCoordinate(currentCoordinates.latitude, currentCoordinates.longitude)) {
            return [];
        }
        const nearby: NearbyExplorer[] = [];
        for (const user of allUsers) {
            if (!user.telemetryEnabled ||
                !user.location) {
                continue;
            }
            const distanceKm = calculateHaversineDistanceKm(currentCoordinates.latitude, currentCoordinates.longitude, user.location.latitude, user.location.longitude);
            if (distanceKm >
                RADIUS_KM) {
                continue;
            }
            nearby.push({
                uid: user.uid,
                name: user.name,
                initial: user.initial,
                distanceKm,
                distanceFormatted: formatDistance(distanceKm),
                friendMeta: friendshipsMap[user.uid],
            });
        }
        return nearby.sort((explorerA, explorerB) => explorerA.distanceKm -
            explorerB.distanceKm);
    }, [
        allUsers,
        currentCoordinates,
        friendshipsMap,
    ]);
    const currentUsername = useMemo(() => normaliseName(currentUserProfile
        ?.username ??
        currentUser
            ?.displayName ??
        currentUser
            ?.email
            ?.split('@')[0], 'FIELD EXPLORER'), [
        currentUser
            ?.displayName,
        currentUser
            ?.email,
        currentUserProfile
            ?.username,
    ]);
    const [publishRevision, setPublishRevision] = useState(0);
    useEffect(() => {
        if (!isCurrent() || !currentUserProfile || isPublishingLocationRef.current) return;
        const sharing = currentUserProfile.telemetryEnabled === true;
        if (sharing && !livePosition) return;
        if (!sharing && !currentUserProfile.location) return;
        const key = sharing ? latitude + ':' + longitude : 'clear';
        const attemptKey = retryKey + ':' + key;
        if (lastPublishedLocationRef.current === attemptKey) return;
        lastPublishedLocationRef.current = attemptKey;
        isPublishingLocationRef.current = true;
        setLocationPublishError(null);
        void runTransaction(db, async transaction => {
            const reference = doc(db, 'users', currentUserId);
            const snapshot = await transaction.get(reference);
            if (!isCurrent() || !snapshot.exists()) return;
            const latest = snapshot.data();
            if (latest.telemetryEnabled !== true) {
                if (latest.location) transaction.update(reference, { location: deleteField(), updatedAt: serverTimestamp() });
            } else if (sharing && livePosition && isFreshLocation(livePosition)) {
                const old = extractCoordinates(latest.location);
                if (!old || calculateHaversineDistanceKm(old.latitude, old.longitude, livePosition.coords.latitude, livePosition.coords.longitude) > LOCATION_PUBLISH_DISTANCE_KM) {
                    transaction.update(reference, { location: new GeoPoint(livePosition.coords.latitude, livePosition.coords.longitude), updatedAt: serverTimestamp() });
                }
            }
        }).catch(error => {
            logDevelopmentWarning('[Treasi Social] Location sharing failed:', error);
            if (isCurrent()) setLocationPublishError('LOCATION SHARING SYNC FAILED');
        }).finally(() => {
            isPublishingLocationRef.current = false;
            if (isCurrent()) setPublishRevision(value => value + 1);
        });
    }, [currentUserId, currentUserProfile, latitude, longitude, livePosition, retryKey, publishRevision, isCurrent]);
    const handleLocationAction = useCallback(async (): Promise<void> => {
        if (locationStatus ===
            'CHECKING') {
            return;
        }
        if (Platform.OS !==
            'web' &&
            (locationServicesEnabled ===
                false ||
                (locationPermissionStatus ===
                    Location
                        .PermissionStatus
                        .DENIED &&
                    !canAskLocationAgain))) {
            try {
                await Linking.openSettings();
            }
            catch (error: unknown) {
                logDevelopmentWarning('[Treasi Social] Unable to open device settings:', error);
                showAccessibleAlert('Settings Unavailable', 'Open your device settings manually and enable foreground location access for Treasi.');
            }
            return;
        }
        if (Platform.OS ===
            'web' &&
            locationPermissionStatus ===
                Location
                    .PermissionStatus
                    .DENIED &&
            !canAskLocationAgain) {
            showAccessibleAlert('Browser Location Blocked', 'Allow location for this site in your browser settings, then return to Treasi and retry the scan.');
            return;
        }
        await refreshCurrentLocation(true);
    }, [
        canAskLocationAgain,
        locationPermissionStatus,
        locationServicesEnabled,
        locationStatus,
        refreshCurrentLocation,
    ]);

    const applyFriendship = useCallback((friendship: FriendshipMeta | null, id: string) => {
        const update = (items: FriendshipMeta[], requester: boolean) => {
            const remaining = items.filter(item => item.docId !== id && item.targetUid !== friendship?.targetUid);
            return friendship && friendship.isRequester === requester ? [...remaining, friendship] : remaining;
        };
        setOutgoingFriendships(items => update(items, true));
        setIncomingFriendships(items => update(items, false));
    }, []);
    const handleSendFriendRequest = useCallback(async (targetUid: string, targetName: string): Promise<boolean> => {
        if (!isCurrent() || friendLockRef.current || !targetUid || targetUid.includes('/') || targetUid === currentUserId) return false;
        friendLockRef.current = true;
        setActionUid(targetUid);
        const existing = friendshipsMap[targetUid];
        const id = getDeterministicFriendshipId(currentUserId, targetUid);
        try {
            await runTransaction(db, async transaction => {
                const reference = doc(db, 'friendships', id);
                const snapshot = await transaction.get(reference);
                const legacy = existing && existing.docId !== id ? await transaction.get(doc(db, 'friendships', existing.docId)) : null;
                const target = await transaction.get(doc(db, 'users', targetUid));
                if (!isCurrent()) throw new Error('SESSION_CHANGED');
                if (!target.exists()) throw new Error('EXPLORER_NOT_FOUND');
                for (const record of [snapshot, legacy]) {
                    if (!record?.exists()) continue;
                    const data = record.data();
                    if (!((data.requesterId === currentUserId && data.receiverId === targetUid) ||
                        (data.receiverId === currentUserId && data.requesterId === targetUid))) throw new Error('LINK_CHANGED');
                    if (data.status === 'blocked') throw new Error('LINK_BLOCKED');
                    if (data.status === 'pending' || data.status === 'accepted') throw new Error('LINK_EXISTS');
                    if (data.status !== 'declined') throw new Error('LINK_CHANGED');
                }
                if (legacy?.exists() && existing) transaction.delete(doc(db, 'friendships', existing.docId));
                transaction.set(reference, { friendshipId: id, requesterId: currentUserId, receiverId: targetUid,
                    status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                transaction.set(doc(collection(db, 'activity_feed')), { userId: currentUserId, username: currentUsername,
                    type: 'FRIEND_REQUEST', message: 'SENT LINK REQUEST TO ' + normaliseName(targetName),
                    targetId: targetUid, createdAt: serverTimestamp() });
            });
            if (!isCurrent()) return false;
            applyFriendship({ docId: id, targetUid, status: 'pending', isRequester: true }, id);
            showAccessibleAlert('Request Sent', 'A link request was sent to ' + targetName + '.');
            return true;
        } catch (error) {
            logDevelopmentWarning('[Treasi Social] Friend request failed:', error);
            if (isCurrent()) showAccessibleAlert('Link Request Unavailable', error instanceof Error && error.message === 'LINK_BLOCKED'
                ? 'This Explorer relationship is currently blocked.' : error instanceof Error && error.message === 'LINK_EXISTS'
                ? 'An active link or pending request already exists. Refresh the network to see its current status.'
                : 'Treasi could not issue this link request. Refresh the network and try again.');
            return false;
        } finally { friendLockRef.current = false; if (isCurrent()) setActionUid(null); }
    }, [isCurrent, currentUserId, currentUsername, friendshipsMap, applyFriendship]);

    const changeFriendship = useCallback(async (friendship: FriendshipMeta, targetName: string, action: 'accepted' | 'declined' | 'remove') => {
        if (!isCurrent() || friendLockRef.current) return;
        friendLockRef.current = true;
        setActionUid(friendship.docId);
        try {
            await runTransaction(db, async transaction => {
                const reference = doc(db, 'friendships', friendship.docId);
                const snapshot = await transaction.get(reference);
                if (!isCurrent()) throw new Error('SESSION_CHANGED');
                if (!snapshot.exists()) throw new Error('LINK_CHANGED');
                const latest = snapshot.data();
                const requester = latest.requesterId === currentUserId && latest.receiverId === friendship.targetUid;
                const receiver = latest.receiverId === currentUserId && latest.requesterId === friendship.targetUid;
                if ((!requester && !receiver) || latest.status !== friendship.status || requester !== friendship.isRequester || latest.status === 'blocked') throw new Error('LINK_CHANGED');
                if (action !== 'remove' && (!receiver || latest.status !== 'pending')) throw new Error('LINK_CHANGED');
                if (action === 'remove') transaction.delete(reference);
                else transaction.update(reference, { status: action, updatedAt: serverTimestamp() });
                if (action === 'accepted') transaction.set(doc(collection(db, 'activity_feed')), {
                    userId: currentUserId, username: currentUsername, type: 'FRIEND_ACCEPTED',
                    message: 'ACCEPTED LINK WITH ' + normaliseName(targetName), targetId: friendship.targetUid, createdAt: serverTimestamp() });
            });
            if (!isCurrent()) return;
            applyFriendship(action === 'remove' ? null : { ...friendship, status: action }, friendship.docId);
            AccessibilityInfo.announceForAccessibility(action === 'remove' ? 'Explorer link record removed.' : 'Explorer link ' + action + '.');
        } catch (error) {
            logDevelopmentWarning('[Treasi Social] Friendship update failed:', error);
            if (isCurrent()) showAccessibleAlert('Link Error', 'This relationship could not be updated. Refresh the network and try again.');
        } finally { friendLockRef.current = false; if (isCurrent()) setActionUid(null); }
    }, [isCurrent, currentUserId, currentUsername, applyFriendship]);
    const handleAcceptFriendRequest = useCallback((friendship: FriendshipMeta, name: string) => changeFriendship(friendship, name, 'accepted'), [changeFriendship]);
    const handleDeclineFriendRequest = useCallback((friendship: FriendshipMeta, name: string) => changeFriendship(friendship, name, 'declined'), [changeFriendship]);
    const handleRemoveFriendship = useCallback((friendship: FriendshipMeta, name: string) => {
        if (!isCurrent() || friendLockRef.current) return;
        const pending = friendship.status === 'pending';
        Alert.alert(pending ? 'Cancel Request' : 'Terminate Link', pending ? 'Cancel the pending request to ' + name + '?' : 'Disconnect your Explorer link with ' + name + '?', [
            { text: 'CANCEL', style: 'cancel' },
            { text: pending ? 'CANCEL REQUEST' : 'UNLINK', style: 'destructive', onPress: () => { void changeFriendship(friendship, name, 'remove'); } },
        ]);
    }, [isCurrent, changeFriendship]);
    const handleSearchAndLinkAgent = useCallback(async (): Promise<void> => {
        if (!isCurrent() || searchLockRef.current || friendLockRef.current) {
            return;
        }
        const searchTag = searchAgentTag
            .trim()
            .toUpperCase();
        if (searchTag.length > MAX_CALLSIGN_LENGTH) { setSearchError('CALLSIGN MUST BE 24 CHARACTERS OR FEWER'); return; }
        if (!searchTag) {
            setSearchError('ENTER AN EXPLORER CALLSIGN');
            return;
        }
        setSearchError(null);
        searchLockRef.current = true;
        setIsSearching(true);
        try {
            const searchQuery = query(collection(db, 'users'), where('username', '==', searchTag), limit(3));
            const snapshot = await getDocs(searchQuery);
            if (!isCurrent()) return;
            const candidates = snapshot.docs.filter((documentSnapshot) => documentSnapshot.id !==
                currentUserId);
            if (candidates.length ===
                0) {
                setSearchError('EXPLORER CALLSIGN NOT FOUND');
                return;
            }
            if (candidates.length > 1) { setSearchError('MULTIPLE EXPLORERS USE THIS CALLSIGN'); return; }
            const selected = candidates[0];
            const data = selected.data() as UserDocument;
            const targetName = normaliseName(data.username);
            const sent = await handleSendFriendRequest(selected.id, targetName);
            if (sent &&
                isCurrent()) {
                setFriendModalVisible(false);
                setSearchAgentTag('');
            }
        }
        catch (error: unknown) {
            logDevelopmentWarning('[Treasi Social] Callsign search failed:', error);
            if (isCurrent()) {
                setSearchError('CALLSIGN SEARCH FAILED');
            }
        }
        finally {
            searchLockRef.current = false;
            if (isCurrent()) {
                setIsSearching(false);
            }
        }
    }, [
        isCurrent,
        currentUserId,
        handleSendFriendRequest,
        isSearching,
        searchAgentTag,
    ]);
    const handleDispatchTelegram = useCallback(async (): Promise<void> => {
        if (!isCurrent() || telegramLockRef.current) {
            return;
        }
        const message = telegramText
            .trim()
            .slice(0, MAX_TELEGRAM_LENGTH);
        if (!message) {
            showAccessibleAlert('Empty Telegram', 'Enter a message before transmitting the signal.');
            return;
        }
        telegramLockRef.current = true;
        setIsTransmitting(true);
        try {
            const messageReference = doc(collection(db, 'messages'));
            const activityReference = doc(collection(db, 'activity_feed'));
            const preview = message.length >
                40
                ? `${message.slice(0, 40)}…`
                : message;
            const batch = writeBatch(db);
            batch.set(messageReference, {
                messageId: messageReference.id,
                senderId: currentUserId,
                senderName: currentUsername,
                text: message,
                createdAt: serverTimestamp(),
                type: 'GLOBAL_DISPATCH',
            });
            batch.set(activityReference, {
                userId: currentUserId,
                username: currentUsername,
                type: 'TELEGRAM_DISPATCH',
                message: `DISPATCHED TELEGRAM: "${preview}"`,
                targetId: messageReference.id,
                createdAt: serverTimestamp(),
            });
            await batch.commit();
            if (!isCurrent()) {
                return;
            }
            setTelegramText('');
            showAccessibleAlert('Signal Transmitted', 'Your Telegram was dispatched to the Explorer network.');
        }
        catch (error: unknown) {
            logDevelopmentWarning('[Treasi Social] Telegram transmission failed:', error);
            if (isCurrent()) showAccessibleAlert('Transmission Failed', 'The Telegram could not be dispatched. Check your connection and try again.');
        }
        finally {
            telegramLockRef.current = false;
            if (isCurrent()) {
                setIsTransmitting(false);
            }
        }
    }, [
        isCurrent,
        currentUserId,
        currentUsername,
        isTransmitting,
        telegramText,
    ]);
    const handleRetry = useCallback((): void => {
        setExplorerError(null);
        setTelegramError(null);
        setProfileError(null);
        setFriendshipErrors({
            outgoing: null,
            incoming: null,
        });
        setLoadingExplorers(true);
        setLoadingDispatches(true);
        setRetryKey((current) => current + 1);
        AccessibilityInfo
            .announceForAccessibility('Retrying Explorer network synchronisation.');
    }, []);
    const friendshipErrorText = useMemo(() => [
        friendshipErrors
            .incoming,
        friendshipErrors
            .outgoing,
    ]
        .filter((value): value is string => Boolean(value))
        .join(' · '), [
        friendshipErrors,
    ]);
    const networkErrorText = useMemo(() => [
        profileError,
        explorerError,
        friendshipErrorText,
        locationPublishError,
    ]
        .filter((value): value is string => Boolean(value))
        .join(' · '), [
        explorerError,
        friendshipErrorText,
        locationPublishError,
        profileError,
    ]);
    const locationStatusText = useMemo(() => {
        switch (locationStatus) {
            case 'CHECKING':
                return 'CHECKING LOCAL POSITION';
            case 'READY':
                return currentCoordinates
                    ? 'LOCAL POSITION READY'
                    : 'POSITION UNAVAILABLE';
            case 'PERMISSION_REQUIRED':
                return 'LOCATION ACCESS NOT YET ENABLED';
            case 'DENIED':
                return 'LOCATION ACCESS DENIED';
            case 'SERVICES_OFF':
                return 'DEVICE LOCATION SERVICES OFF';
            default:
                return Platform.OS ===
                    'web'
                    ? 'BROWSER LOCATION UNAVAILABLE'
                    : 'DEVICE LOCATION UNAVAILABLE';
        }
    }, [
        currentCoordinates,
        locationStatus,
    ]);
    const locationActionLabel = useMemo(() => {
        if (locationStatus ===
            'CHECKING') {
            return 'CHECKING';
        }
        if (Platform.OS !==
            'web' &&
            (locationServicesEnabled ===
                false ||
                (locationPermissionStatus ===
                    Location
                        .PermissionStatus
                        .DENIED &&
                    !canAskLocationAgain))) {
            return 'OPEN SETTINGS';
        }
        if (locationStatus ===
            'PERMISSION_REQUIRED' ||
            locationStatus ===
                'DENIED') {
            return 'ENABLE LOCATION';
        }
        return 'REFRESH POSITION';
    }, [
        canAskLocationAgain,
        locationPermissionStatus,
        locationServicesEnabled,
        locationStatus,
    ]);
    const telemetrySharingEnabled = currentUserProfile
        ?.telemetryEnabled ===
        true;
const renderExplorerActions =
      (
        item:
          NearbyExplorer,
      ): React.ReactNode => {
        const friendMeta =
          item.friendMeta;

        const isActing = Boolean(actionUid) || actionUid ===
            item.uid ||
          actionUid ===
            friendMeta
              ?.docId;

        if (
          !friendMeta
        ) {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Send friend request to ${item.name}`}
              accessibilityHint="Creates a pending Explorer link request."
              accessibilityState={{
                disabled:
                  isActing,
                busy:
                  isActing,
              }}
              disabled={
                isActing
              }
              hitSlop={4}
              onPress={() => {
                void handleSendFriendRequest(
                  item.uid,
                  item.name,
                );
              }}
              style={({
                pressed,
              }) => [
                styles.compactActionButton,

                isActing &&
                  styles.disabledButton,

                pressed &&
                  !isActing &&
                  styles.lightButtonPressed,
              ]}
            >
              {isActing ? (
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.ink900
                  }
                />
              ) : (
                <Ionicons
                  name="person-add-outline"
                  size={17}
                  color={
                    COLOURS.ink900
                  }
                />
              )}
            </Pressable>
          );
        }

        if (
          friendMeta.status ===
            'pending' &&
          !friendMeta.isRequester
        ) {
          return (
            <View
              style={
                styles.inlineActions
              }
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Accept friend request from ${item.name}`}
                accessibilityState={{
                  disabled:
                    isActing,
                }}
                disabled={
                  isActing
                }
                onPress={() => {
                  void handleAcceptFriendRequest(
                    friendMeta,
                    item.name,
                  );
                }}
                style={({
                  pressed,
                }) => [
                  styles.compactActionButton,
                  styles.acceptButton,

                  isActing &&
                    styles.disabledButton,

                  pressed &&
                    !isActing &&
                    styles.darkButtonPressed,
                ]}
              >
                {isActing ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      COLOURS.parchment100
                    }
                  />
                ) : (
                  <Ionicons
                    name="checkmark-sharp"
                    size={18}
                    color={
                      COLOURS.parchment100
                    }
                  />
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decline friend request from ${item.name}`}
                disabled={
                  isActing
                }
                onPress={() => {
                  void handleDeclineFriendRequest(
                    friendMeta,
                    item.name,
                  );
                }}
                style={({
                  pressed,
                }) => [
                  styles.compactActionButton,
                  styles.declineButton,

                  isActing &&
                    styles.disabledButton,

                  pressed &&
                    !isActing &&
                    styles.primaryButtonPressed,
                ]}
              >
                <Ionicons
                  name="close-sharp"
                  size={18}
                  color={
                    COLOURS.parchment100
                  }
                />
              </Pressable>
            </View>
          );
        }

        if (
          friendMeta.status ===
            'pending'
        ) {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel pending friend request to ${item.name}`}
              accessibilityState={{
                disabled:
                  isActing,
              }}
              disabled={
                isActing
              }
              onPress={() =>
                handleRemoveFriendship(
                  friendMeta,
                  item.name,
                )
              }
              style={({
                pressed,
              }) => [
                styles.statusActionButton,
                styles.pendingButton,

                isActing &&
                  styles.disabledButton,

                pressed &&
                  !isActing &&
                  styles.lightButtonPressed,
              ]}
            >
              <Text
                style={
                  styles.pendingButtonText
                }
              >
                PENDING
              </Text>
            </Pressable>
          );
        }

        if (
          friendMeta.status ===
            'accepted'
        ) {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove friendship with ${item.name}`}
              accessibilityHint="Opens confirmation before removing this Explorer link."
              disabled={
                isActing
              }
              onPress={() =>
                handleRemoveFriendship(
                  friendMeta,
                  item.name,
                )
              }
              style={({
                pressed,
              }) => [
                styles.statusActionButton,
                styles.linkedButton,

                isActing &&
                  styles.disabledButton,

                pressed &&
                  !isActing &&
                  styles.lightButtonPressed,
              ]}
            >
              {isActing ? (
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.ink900
                  }
                />
              ) : (
                <>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={15}
                    color={
                      COLOURS.success700
                    }
                  />

                  <Text
                    style={
                      styles.linkedButtonText
                    }
                  >
                    LINKED
                  </Text>
                </>
              )}
            </Pressable>
          );
        }

        if (
          friendMeta.status ===
            'declined'
        ) {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retry friend request to ${item.name}`}
              disabled={
                isActing
              }
              onPress={() => {
                void handleSendFriendRequest(
                  item.uid,
                  item.name,
                );
              }}
              style={({
                pressed,
              }) => [
                styles.statusActionButton,
                styles.retryLinkButton,

                isActing &&
                  styles.disabledButton,

                pressed &&
                  !isActing &&
                  styles.lightButtonPressed,
              ]}
            >
              <Text
                style={
                  styles.retryLinkText
                }
              >
                RETRY
              </Text>
            </Pressable>
          );
        }

        return (
          <View
            accessible
            accessibilityLabel={`Explorer link with ${item.name} is blocked.`}
            style={
              styles.blockedBadge
            }
          >
            <Ionicons
              name="ban-outline"
              size={14}
              color={
                COLOURS.rust800
              }
            />

            <Text
              style={
                styles.blockedText
              }
            >
              BLOCKED
            </Text>
          </View>
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <KeyboardAvoidingView enabled={!friendModalVisible}
        style={
          styles.keyboardContainer
        }
        behavior={
          Platform.OS ===
          'ios'
            ? 'padding'
            : undefined
        }
      >
        {keyboardVisible && !friendModalVisible && <KeyboardEditingBar title="TELEGRAM" />}

        <View
          style={[
            styles.screen,
            {
              paddingLeft:
                Math.max(
                  insets.left,
                  12,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  12,
                ),

              paddingTop:
                Math.max(
                  insets.top,
                  10,
                ),

              paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 10),
            },
          ]}
        >
          <View
            style={[
              styles.splitWrapper,

              {
                flexDirection:
                  isLandscape
                    ? 'row'
                    : 'column',
              },
            ]}
          >
            {/* ============================================================= */}
            {/* 60% — TELEGRAM FIELD DESK                                    */}
            {/* ============================================================= */}

            <FormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}
              style={[styles.telegramPanel, (keyboardVisible && !friendModalVisible) && { flex: 1 }]}
            >
              {/* ------------------------------------------------------------ */}
              {/* Header                                                       */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[styles.lightPanelHeader, (keyboardVisible && !friendModalVisible) && { display: 'none' }]}
              >
                <View
                  style={
                    styles.headerIdentity
                  }
                >
                  <MaterialCommunityIcons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="radio-tower"
                    size={19}
                    color={
                      COLOURS.rust700
                    }
                  />

                  <View
                    style={
                      styles.headerTextContainer
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      maxFontSizeMultiplier={
                        1.6
                      }
                      style={
                        styles.lightPanelTitle
                      }
                    >
                      TELEGRAM FIELD DESK
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={
                        styles.lightPanelSubtitle
                      }
                    >
                      ASYNCHRONOUS EXPLORER DISPATCH NETWORK
                    </Text>
                  </View>
                </View>

                <View
                  accessible
                  accessibilityLabel={`Signed in as ${currentUsername}`}
                  style={
                    styles.callsignBadge
                  }
                >
                  <Text
                    numberOfLines={
                      1
                    }
                    style={
                      styles.callsignBadgeText
                    }
                  >
                    {
                      currentUsername
                    }
                  </Text>
                </View>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Composer                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.composerCard
                }
              >
                <View
                  style={
                    styles.composerHeader
                  }
                >
                  <View
                    style={
                      styles.sectionTitleRowLight
                    }
                  >
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="paper-plane-outline"
                      size={16}
                      color={
                        COLOURS.rust700
                      }
                    />

                    <Text
                      accessibilityRole="header"
                      style={
                        styles.lightSectionTitle
                      }
                    >
                      BROADCAST TELEGRAM
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.characterCounter
                    }
                  >
                    {
                      telegramText.length
                    }
                    /
                    {
                      MAX_TELEGRAM_LENGTH
                    }
                  </Text>
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={[styles.composerDescription, (keyboardVisible && !friendModalVisible) && { display: 'none' }]}
                >
                  Public dispatches are visible to authenticated Treasi Explorers. Do not include private or sensitive information.
                </Text>

                <FormTextInput
                  accessibilityLabel="Telegram broadcast message"
                  accessibilityHint="Enter a public message of up to 500 characters."
                  editable={
                    !isTransmitting
                  }
                  multiline
                  maxLength={
                    MAX_TELEGRAM_LENGTH
                  }
                  placeholder="TYPE PUBLIC FIELD DISPATCH..."
                  placeholderTextColor={
                    COLOURS.bronze700
                  }
                  textAlignVertical="top"
                  value={
                    telegramText
                  }
                  onChangeText={
                    setTelegramText
                  }
                  selectionColor={
                    COLOURS.rust700
                  }
                  style={
                    styles.telegramInput
                  }
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isTransmitting
                      ? 'Transmitting Telegram'
                      : 'Transmit Telegram'
                  }
                  accessibilityHint="Publishes this message to the authenticated Explorer network."
                  accessibilityState={{
                    busy:
                      isTransmitting,

                    disabled:
                      isTransmitting,
                  }}
                  disabled={
                    isTransmitting
                  }
                  onPress={() => {
                    void handleDispatchTelegram();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.transmitButton,

                    isTransmitting &&
                      styles.disabledButton,

                    pressed &&
                      !isTransmitting &&
                      styles.primaryButtonPressed,
                  ]}
                >
                  {isTransmitting ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.parchment100
                      }
                    />
                  ) : (
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="paper-plane"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  )}

                  <Text
                    style={
                      styles.transmitButtonText
                    }
                  >
                    {isTransmitting
                      ? 'TRANSMITTING...'
                      : 'TRANSMIT SIGNAL'}
                  </Text>
                </Pressable>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Dispatch feed                                                */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[styles.dispatchFeedSection, (keyboardVisible && !friendModalVisible) && { display: 'none' }]}
              >
                <View
                  style={
                    styles.feedHeader
                  }
                >
                  <View
                    style={
                      styles.sectionTitleRowLight
                    }
                  >
                    <MaterialCommunityIcons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="radio-handheld"
                      size={16}
                      color={
                        COLOURS.rust700
                      }
                    />

                    <Text
                      accessibilityRole="header"
                      style={
                        styles.lightSectionTitle
                      }
                    >
                      RECENT TELEGRAMS
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.dispatchCount
                    }
                  >
                    {
                      globalDispatches.length
                    }{' '}
                    SIGNALS
                  </Text>
                </View>

                {telegramError ? (
                  <View accessibilityRole="alert"
                    style={
                      styles.lightErrorCard
                    }
                  >
                    <Ionicons
                      name="cloud-offline-outline"
                      size={18}
                      color={
                        COLOURS.rust800
                      }
                    />

                    <Text
                      style={
                        styles.lightErrorText
                      }
                    >
                      {
                        telegramError
                      }
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry Telegram synchronisation"
                      onPress={
                        handleRetry
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.lightRetryButton,

                        pressed &&
                          styles.lightButtonPressed,
                      ]}
                    >
                      <Text
                        style={
                          styles.lightRetryText
                        }
                      >
                        RETRY
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {loadingDispatches &&
                globalDispatches.length ===
                  0 ? (
                  <View
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel="Loading recent Telegrams"
                    style={
                      styles.feedStateBox
                    }
                  >
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.rust700
                      }
                    />

                    <Text
                      style={
                        styles.feedStateText
                      }
                    >
                      SYNCHRONISING TELEGRAMS…
                    </Text>
                  </View>
                ) : globalDispatches.length ===
                  0 ? (
                  <View
                    accessible
                    accessibilityLabel="No Telegram broadcasts have been received."
                    style={
                      styles.feedStateBox
                    }
                  >
                    <Ionicons
                      name="radio-outline"
                      size={25}
                      color={
                        COLOURS.bronze700
                      }
                    />

                    <Text
                      style={
                        styles.feedStateText
                      }
                    >
                      NO TELEGRAMS RECEIVED
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    accessibilityLabel="Recent public Telegram broadcasts"
                    style={
                      styles.dispatchScroll
                    }
                    contentContainerStyle={
                      styles.dispatchScrollContent
                    }
                    showsVerticalScrollIndicator={
                      false
                    }
                    keyboardShouldPersistTaps="handled"
                  >
                    {globalDispatches.map(
                      (
                        dispatch,
                      ) => {
                        const isOwnDispatch =
                          dispatch.senderId ===
                          currentUserId;

                        return (
                          <View
                            key={
                              dispatch.messageId
                            }
                            accessible
                            accessibilityLabel={`${
                              isOwnDispatch
                                ? 'You'
                                : dispatch.senderName
                            }. ${dispatch.text}. ${formatRelativeTime(
                              dispatch.createdAt,
                            )}.`}
                            style={[
                              styles.dispatchCard,

                              isOwnDispatch &&
                                styles.ownDispatchCard,
                            ]}
                          >
                            <View
                              accessible={
                                false
                              }

                              style={
                                styles.dispatchCardHeader
                              }
                            >
                              <View
                                style={
                                  styles.dispatchSenderRow
                                }
                              >
                                <Ionicons
                                  name="radio-outline"
                                  size={14}
                                  color={
                                    isOwnDispatch
                                      ? COLOURS.rust700
                                      : COLOURS.bronze700
                                  }
                                />

                                <Text
                                  numberOfLines={
                                    1
                                  }
                                  style={[
                                    styles.dispatchSender,

                                    isOwnDispatch &&
                                      styles.ownDispatchSender,
                                  ]}
                                >
                                  {isOwnDispatch
                                    ? `YOU · ${dispatch.senderName}`
                                    : dispatch.senderName}
                                </Text>
                              </View>

                              <Text
                                style={
                                  styles.dispatchTime
                                }
                              >
                                {formatRelativeTime(
                                  dispatch.createdAt,
                                )}
                              </Text>
                            </View>

                            <Text
                              accessible={
                                false
                              }
                              importantForAccessibility="no"
                              maxFontSizeMultiplier={
                                1.8
                              }
                              style={
                                styles.dispatchText
                              }
                            >
                              {
                                dispatch.text
                              }
                            </Text>
                          </View>
                        );
                      },
                    )}
                  </ScrollView>
                )}
              </View>

              <View
                style={[styles.lightPanelFooter, (keyboardVisible && !friendModalVisible) && { display: 'none' }]}
              >
                <Text
                  maxFontSizeMultiplier={
                    1.4
                  }
                  style={
                    styles.lightPanelFooterText
                  }
                >
                  TELEGRAMS ARE ASYNCHRONOUS PUBLIC FIELD SIGNALS
                </Text>
              </View>
            </FormScrollView>

            {/* ============================================================= */}
            {/* 40% — EXPLORER NETWORK                                       */}
            {/* ============================================================= */}

            <View
              style={[styles.networkPanel, (keyboardVisible && !friendModalVisible) && { display: 'none' }]}
            >
              <ScrollView
                style={
                  styles.networkScroll
                }
                contentContainerStyle={
                  styles.networkScrollContent
                }
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={
                  false
                }
              >
                {/* ---------------------------------------------------------- */}
                {/* Header                                                     */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={
                    styles.darkPanelHeader
                  }
                >
                  <View
                    style={
                      styles.headerIdentity
                    }
                  >
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="people-outline"
                      size={18}
                      color={
                        COLOURS.bronze400
                      }
                    />

                    <View
                      style={
                        styles.headerTextContainer
                      }
                    >
                      <Text
                        accessibilityRole="header"
                        maxFontSizeMultiplier={
                          1.6
                        }
                        style={
                          styles.darkPanelTitle
                        }
                      >
                        EXPLORER NETWORK
                      </Text>

                      <Text
                        style={
                          styles.darkPanelSubtitle
                        }
                      >
                        LINKS · REQUESTS · LOCAL RANGE
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Link a new Explorer"
                    accessibilityHint="Opens callsign search."
                    onPress={() => {
                      setSearchAgentTag(
                        '',
                      );

                      setSearchError(
                        null,
                      );

                      setFriendModalVisible(
                        true,
                      );
                    }}
                    style={({
                      pressed,
                    }) => [
                      styles.addExplorerButton,

                      pressed &&
                        styles.darkButtonPressed,
                    ]}
                  >
                    <Ionicons
                      name="person-add-outline"
                      size={19}
                      color={
                        COLOURS.bronze400
                      }
                    />
                  </Pressable>
                </View>

                {/* ---------------------------------------------------------- */}
                {/* Sync warning                                               */}
                {/* ---------------------------------------------------------- */}

                {networkErrorText ? (
                  <View accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={
                      styles.darkErrorCard
                    }
                  >
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="warning-outline"
                      size={17}
                      color={
                        COLOURS.danger300
                      }
                    />

                    <Text
                      style={
                        styles.darkErrorText
                      }
                    >
                      {
                        networkErrorText
                      }
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry Explorer network synchronisation"
                      onPress={
                        handleRetry
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.darkRetryButton,

                        pressed &&
                          styles.darkButtonPressed,
                      ]}
                    >
                      <Text
                        style={
                          styles.darkRetryText
                        }
                      >
                        RETRY
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* ---------------------------------------------------------- */}
                {/* Location and privacy                                       */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={
                    styles.sectionHeaderRow
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="location-outline"
                    size={16}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    accessibilityRole="header"
                    style={
                      styles.darkSectionTitle
                    }
                  >
                    LOCAL SCAN
                  </Text>
                </View>

                <View accessibilityLabel={`${locationStatusText}. Location sharing is ${
                    telemetrySharingEnabled
                      ? 'enabled'
                      : 'disabled'
                  }.`}
                  style={
                    styles.locationCard
                  }
                >
                  <View
                    accessible={
                      false
                    }

                    style={
                      styles.locationStatusRow
                    }
                  >
                    <View
                      style={[
                        styles.locationDot,

                        locationStatus ===
                          'READY'
                          ? styles.locationDotReady
                          : locationStatus ===
                              'CHECKING'
                            ? styles.locationDotChecking
                            : styles.locationDotWarning,
                      ]}
                    />

                    <View
                      style={
                        styles.locationStatusTextContainer
                      }
                    >
                      <Text
                        style={
                          styles.locationStatusTitle
                        }
                      >
                        {
                          locationStatusText
                        }
                      </Text>

                      <Text
                        style={
                          styles.locationSharingText
                        }
                      >
                        {telemetrySharingEnabled
                          ? 'TELEMETRY SHARING: ON'
                          : 'TELEMETRY SHARING: OFF'}
                      </Text>
                    </View>
                  </View>

                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={
                      styles.locationPrivacyText
                    }
                  >
                    Your local position is used to calculate range. It is only written to your Explorer profile when Telemetry Sharing is enabled.
                  </Text>

                  <View
                    style={
                      styles.locationActions
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        locationActionLabel
                      }
                      accessibilityHint="Checks or enables the location access used for nearby Explorer range."
                      accessibilityState={{
                        busy:
                          locationStatus ===
                          'CHECKING',

                        disabled:
                          locationStatus ===
                          'CHECKING',
                      }}
                      disabled={
                        locationStatus ===
                        'CHECKING'
                      }
                      onPress={() => {
                        void handleLocationAction();
                      }}
                      style={({
                        pressed,
                      }) => [
                        styles.locationActionButton,

                        locationStatus ===
                          'CHECKING' &&
                          styles.disabledButton,

                        pressed &&
                          locationStatus !==
                            'CHECKING' &&
                          styles.darkButtonPressed,
                      ]}
                    >
                      {locationStatus ===
                      'CHECKING' ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            COLOURS.parchment100
                          }
                        />
                      ) : (
                        <Ionicons
                          name="locate-outline"
                          size={16}
                          color={
                            COLOURS.parchment100
                          }
                        />
                      )}

                      <Text
                        style={
                          styles.locationActionText
                        }
                      >
                        {
                          locationActionLabel
                        }
                      </Text>
                    </Pressable>

                    {!telemetrySharingEnabled ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open Profile Settings"
                        accessibilityHint="Opens Profile Settings where Telemetry Sharing can be changed."
                        accessibilityState={{
                          disabled:
                            !onNavigate,
                        }}
                        disabled={
                          !onNavigate
                        }
                        onPress={() =>
                          onNavigate?.(
                            'PROFILE',
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.locationSettingsButton,

                          !onNavigate &&
                            styles.disabledButton,

                          pressed &&
                            onNavigate &&
                            styles.darkButtonPressed,
                        ]}
                      >
                        <Ionicons
                          name="settings-outline"
                          size={16}
                          color={
                            COLOURS.bronze400
                          }
                        />

                        <Text
                          style={
                            styles.locationSettingsText
                          }
                        >
                          SHARING
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {/* ---------------------------------------------------------- */}
                {/* Incoming requests                                          */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={[
                    styles.sectionHeaderRow,
                    styles.sectionSpacing,
                  ]}
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="mail-unread-outline"
                    size={16}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    accessibilityRole="header"
                    style={
                      styles.darkSectionTitle
                    }
                  >
                    LINK REQUESTS
                  </Text>

                  {incomingRequests.length >
                  0 ? (
                    <View
                      accessibilityLabel={`${incomingRequests.length} pending link requests`}
                      style={
                        styles.countBadge
                      }
                    >
                      <Text
                        style={
                          styles.countBadgeText
                        }
                      >
                        {
                          incomingRequests.length
                        }
                      </Text>
                    </View>
                  ) : null}
                </View>

                {incomingRequests.length ===
                0 ? (
                  <View
                    accessible
                    accessibilityLabel="No pending Explorer link requests."
                    style={
                      styles.emptyDarkCard
                    }
                  >
                    <Text
                      style={
                        styles.emptyDarkText
                      }
                    >
                      NO PENDING REQUESTS
                    </Text>
                  </View>
                ) : (
                  <View
                    style={
                      styles.networkList
                    }
                  >
                    {incomingRequests.map(
                      (
                        item,
                      ) => {
                        const name =
                          item.explorer
                            ?.name ??
                          'EXPLORER';

                        const initial =
                          item.explorer
                            ?.initial ??
                          'E';

                        const isActing = Boolean(actionUid) || actionUid ===
                          item.friendship
                            .docId;

                        return (
                          <View
                            key={
                              item.friendship
                                .docId
                            }
                            accessibilityLabel={`${name}. Pending friend request.`}
                            style={
                              styles.requestCard
                            }
                          >
                            <View
                              accessible={
                                false
                              }

                              style={
                                styles.explorerIdentity
                              }
                            >
                              <View
                                style={
                                  styles.avatarDark
                                }
                              >
                                <Text
                                  style={
                                    styles.avatarDarkText
                                  }
                                >
                                  {
                                    initial
                                  }
                                </Text>
                              </View>

                              <View
                                style={
                                  styles.explorerTextContainer
                                }
                              >
                                <Text
                                  numberOfLines={
                                    1
                                  }
                                  style={
                                    styles.requestName
                                  }
                                >
                                  {
                                    name
                                  }
                                </Text>

                                <Text
                                  style={
                                    styles.requestMeta
                                  }
                                >
                                  REQUESTING LINK
                                </Text>
                              </View>
                            </View>

                            <View
                              style={
                                styles.inlineActions
                              }
                            >
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Accept request from ${name}`}
                                disabled={
                                  isActing
                                }
                                onPress={() => {
                                  void handleAcceptFriendRequest(
                                    item.friendship,
                                    name,
                                  );
                                }}
                                style={({
                                  pressed,
                                }) => [
                                  styles.requestActionButton,
                                  styles.acceptButton,

                                  isActing &&
                                    styles.disabledButton,

                                  pressed &&
                                    !isActing &&
                                    styles.darkButtonPressed,
                                ]}
                              >
                                {isActing ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={
                                      COLOURS.parchment100
                                    }
                                  />
                                ) : (
                                  <Ionicons
                                    name="checkmark-sharp"
                                    size={18}
                                    color={
                                      COLOURS.parchment100
                                    }
                                  />
                                )}
                              </Pressable>

                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Decline request from ${name}`}
                                disabled={
                                  isActing
                                }
                                onPress={() => {
                                  void handleDeclineFriendRequest(
                                    item.friendship,
                                    name,
                                  );
                                }}
                                style={({
                                  pressed,
                                }) => [
                                  styles.requestActionButton,
                                  styles.declineButton,

                                  isActing &&
                                    styles.disabledButton,

                                  pressed &&
                                    !isActing &&
                                    styles.primaryButtonPressed,
                                ]}
                              >
                                <Ionicons
                                  name="close-sharp"
                                  size={18}
                                  color={
                                    COLOURS.parchment100
                                  }
                                />
                              </Pressable>
                            </View>
                          </View>
                        );
                      },
                    )}
                  </View>
                )}

                {/* ---------------------------------------------------------- */}
                {/* Active friends                                             */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={[
                    styles.sectionHeaderRow,
                    styles.sectionSpacing,
                  ]}
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="people-circle-outline"
                    size={16}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    accessibilityRole="header"
                    style={
                      styles.darkSectionTitle
                    }
                  >
                    ACTIVE LINKS
                  </Text>

                  <View
                    style={
                      styles.countBadge
                    }
                  >
                    <Text
                      style={
                        styles.countBadgeText
                      }
                    >
                      {
                        acceptedLinks.length
                      }
                    </Text>
                  </View>
                </View>

                {acceptedLinks.length ===
                0 ? (
                  <View
                    accessible
                    accessibilityLabel="No active Explorer links."
                    style={
                      styles.emptyDarkCard
                    }
                  >
                    <Text
                      style={
                        styles.emptyDarkText
                      }
                    >
                      NO ACTIVE LINKS
                    </Text>
                  </View>
                ) : (
                  <View
                    style={
                      styles.networkList
                    }
                  >
                    {acceptedLinks.map(
                      (
                        item,
                      ) => {
                        const name =
                          item.explorer
                            ?.name ??
                          'EXPLORER';

                        const initial =
                          item.explorer
                            ?.initial ??
                          'E';

                        const isActing = Boolean(actionUid) || actionUid ===
                          item.friendship
                            .docId;

                        return (
                          <View
                            key={
                              item.friendship
                                .docId
                            }
                            accessibilityLabel={`${name}. Active Explorer link.`}
                            style={
                              styles.activeLinkCard
                            }
                          >
                            <View
                              accessible={
                                false
                              }

                              style={
                                styles.explorerIdentity
                              }
                            >
                              <View
                                style={
                                  styles.avatarLinked
                                }
                              >
                                <Text
                                  style={
                                    styles.avatarLinkedText
                                  }
                                >
                                  {
                                    initial
                                  }
                                </Text>
                              </View>

                              <View
                                style={
                                  styles.explorerTextContainer
                                }
                              >
                                <Text
                                  numberOfLines={
                                    1
                                  }
                                  style={
                                    styles.activeLinkName
                                  }
                                >
                                  {
                                    name
                                  }
                                </Text>

                                <Text
                                  style={
                                    styles.activeLinkMeta
                                  }
                                >
                                  LINK ESTABLISHED
                                </Text>
                              </View>
                            </View>

                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove friendship with ${name}`}
                              accessibilityHint="Opens confirmation before removing the Explorer link."
                              disabled={
                                isActing
                              }
                              onPress={() =>
                                handleRemoveFriendship(
                                  item.friendship,
                                  name,
                                )
                              }
                              style={({
                                pressed,
                              }) => [
                                styles.unlinkButton,

                                isActing &&
                                  styles.disabledButton,

                                pressed &&
                                  !isActing &&
                                  styles.lightButtonPressed,
                              ]}
                            >
                              {isActing ? (
                                <ActivityIndicator
                                  size="small"
                                  color={
                                    COLOURS.ink900
                                  }
                                />
                              ) : (
                                <Ionicons
                                  name="link-outline"
                                  size={17}
                                  color={
                                    COLOURS.ink900
                                  }
                                />
                              )}
                            </Pressable>
                          </View>
                        );
                      },
                    )}
                  </View>
                )}

                {/* ---------------------------------------------------------- */}
                {/* Nearby Explorers                                           */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={[
                    styles.sectionHeaderRow,
                    styles.sectionSpacing,
                  ]}
                >
                  <MaterialCommunityIcons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="radar"
                    size={17}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    accessibilityRole="header"
                    style={
                      styles.darkSectionTitle
                    }
                  >
                    NEARBY EXPLORERS
                  </Text>
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={
                    styles.nearbyDescription
                  }
                >
                  SHARED POSITIONS WITHIN{' '}
                  {
                    RADIUS_KM
                  }
                  KM · DISTANCE IS BASED ON EACH EXPLORER'S LAST SHARED POSITION
                </Text>

                {loadingExplorers ? (
                  <View
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel="Scanning Explorer directory"
                    style={
                      styles.darkLoadingBox
                    }
                  >
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.bronze400
                      }
                    />

                    <Text
                      style={
                        styles.darkLoadingText
                      }
                    >
                      SCANNING EXPLORER NETWORK…
                    </Text>
                  </View>
                ) : !currentCoordinates ? (
                  <View
                    accessible
                    accessibilityLabel="Your current location is required before nearby Explorer range can be calculated."
                    style={
                      styles.emptyDarkCard
                    }
                  >
                    <Text
                      style={
                        styles.emptyDarkText
                      }
                    >
                      LOCAL POSITION REQUIRED
                    </Text>
                  </View>
                ) : nearbyExplorers.length ===
                  0 ? (
                  <View
                    accessible
                    accessibilityLabel={`No Explorers with shared positions were found within ${RADIUS_KM} kilometres.`}
                    style={
                      styles.emptyDarkCard
                    }
                  >
                    <Text
                      style={
                        styles.emptyDarkText
                      }
                    >
                      NO SHARED POSITIONS IN RANGE
                    </Text>
                  </View>
                ) : (
                  <View
                    style={
                      styles.networkList
                    }
                  >
                    {nearbyExplorers.map(
                      (
                        item,
                      ) => (
                        <View
                          key={
                            item.uid
                          }
                          accessibilityLabel={`${item.name}. Approximately ${item.distanceFormatted} away.${
                            item.friendMeta
                              ? ` Link status ${item.friendMeta.status}.`
                              : ''
                          }`}
                          style={
                            styles.nearbyCard
                          }
                        >
                          <View
                            accessible={
                              false
                            }

                            style={
                              styles.explorerIdentity
                            }
                          >
                            <View
                              style={
                                styles.avatarLight
                              }
                            >
                              <Text
                                style={
                                  styles.avatarLightText
                                }
                              >
                                {
                                  item.initial
                                }
                              </Text>
                            </View>

                            <View
                              style={
                                styles.explorerTextContainer
                              }
                            >
                              <Text
                                numberOfLines={
                                  1
                                }
                                style={
                                  styles.nearbyName
                                }
                              >
                                {
                                  item.name
                                }
                              </Text>

                              <Text
                                style={
                                  styles.nearbyMeta
                                }
                              >
                                RANGE:{' '}
                                {
                                  item.distanceFormatted
                                }
                              </Text>
                            </View>
                          </View>

                          <View>
                            {renderExplorerActions(
                              item,
                            )}
                          </View>
                        </View>
                      ),
                    )}
                  </View>
                )}

                <View
                  style={
                    styles.directoryNotice
                  }
                >
                  <Text
                    maxFontSizeMultiplier={
                      1.5
                    }
                    style={
                      styles.directoryNoticeText
                    }
                  >
                    CURRENT DIRECTORY SCAN LIMIT:{' '}
                    {
                      MAX_EXPLORERS
                    }{' '}
                    PROFILES
                  </Text>
                </View>
              </ScrollView>

              {/* ------------------------------------------------------------ */}
              {/* Navigation                                                   */}
              {/* ------------------------------------------------------------ */}

              {!keyboardVisible && (<FieldNavBar
                currentTab={
                  currentTab
                }
                onNavigate={
                  onNavigate
                }
              />)}
            </View>
          </View>

          {/* ================================================================ */}
          {/* Callsign search modal                                           */}
          {/* ================================================================ */}

          <Modal supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']} visible={
              friendModalVisible
            }
            transparent
            statusBarTranslucent
            presentationStyle="overFullScreen"
            animationType={
              reduceMotionEnabled
                ? 'none'
                : 'fade'
            }
            onRequestClose={() => {
              if (
                !isSearching &&
                !actionUid
              ) {
                setFriendModalVisible(
                  false,
                );
              }
            }}
          >
            <KeyboardAvoidingView accessibilityViewIsModal
              style={
                styles.modalOverlay
              }
              behavior={
                Platform.OS ===
                'ios'
                  ? 'padding'
                  : undefined
              }
            >
        {keyboardVisible && <KeyboardEditingBar title="EDITING" />}

              <Pressable
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={
                  styles.modalDismissBackdrop
                }
                onPress={() => {
                  if (
                    !isSearching &&
                    !actionUid
                  ) {
                    setFriendModalVisible(
                      false,
                    );
                  }
                }}
              />

              <FormScrollView keyboardShouldPersistTaps="handled" bounces={false}

                accessibilityLabel="Link a new Explorer"
                onAccessibilityEscape={() => {
                  if (
                    !isSearching &&
                    !actionUid
                  ) {
                    setFriendModalVisible(
                      false,
                    );
                  }
                }}
                style={
                  styles.modalCard
                }
              >
                <View
                  style={
                    styles.modalHeader
                  }
                >
                  <View
                    style={
                      styles.modalHeaderText
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      maxFontSizeMultiplier={
                        1.6
                      }
                      style={
                        styles.modalTitle
                      }
                    >
                      LINK NEW EXPLORER
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.modalSubtitle
                      }
                    >
                      Enter the exact callsign used by the Explorer you want to link with.
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close Explorer search"
                    accessibilityState={{
                      disabled:
                        isSearching ||
                        Boolean(
                          actionUid,
                        ),
                    }}
                    disabled={
                      isSearching ||
                      Boolean(
                        actionUid,
                      )
                    }
                    hitSlop={4}
                    onPress={() =>
                      setFriendModalVisible(
                        false,
                      )
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.modalCloseButton,

                      pressed &&
                        styles.lightButtonPressed,
                    ]}
                  >
                    <Ionicons
                      name="close-sharp"
                      size={22}
                      color={
                        COLOURS.ink900
                      }
                    />
                  </Pressable>
                </View>

                {searchError ? (
                  <View accessibilityRole="alert"
                    accessibilityLiveRegion="assertive"
                    style={
                      styles.searchErrorCard
                    }
                  >
                    <Text
                      style={
                        styles.searchErrorText
                      }
                    >
                      {
                        searchError
                      }
                    </Text>
                  </View>
                ) : null}

                <Text
                  nativeID="social-callsign-label"
                  style={
                    styles.searchInputLabel
                  }
                >
                  EXPLORER CALLSIGN
                </Text>

                <TextInput
                  accessibilityLabel="Explorer callsign"
                  accessibilityHint="Enter the exact Explorer callsign."
                  autoCapitalize="characters"
                  autoCorrect={
                    false
                  }
                  maxLength={
                    MAX_CALLSIGN_LENGTH
                  }
                  editable={
                    !isSearching &&
                    !actionUid
                  }
                  placeholder="RANGER_JACK"
                  placeholderTextColor={
                    COLOURS.bronze700
                  }
                  returnKeyType="search"
                  selectionColor={
                    COLOURS.rust700
                  }
                  value={
                    searchAgentTag
                  }
                  onChangeText={(
                    text,
                  ) => {
                    setSearchAgentTag(
                      text.toUpperCase(),
                    );

                    setSearchError(
                      null,
                    );
                  }}
                  onSubmitEditing={() => {
                    void handleSearchAndLinkAgent();
                  }}
                  style={
                    styles.searchInput
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.searchHelpText
                  }
                >
                  Callsign search queries Firestore directly and does not depend on the nearby Explorer list.
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSearching
                      ? 'Searching for Explorer'
                      : 'Send Explorer link request'
                  }
                  accessibilityState={{
                    busy:
                      isSearching,

                    disabled:
                      isSearching ||
                      Boolean(
                        actionUid,
                      ),
                  }}
                  disabled={
                    isSearching ||
                    Boolean(
                      actionUid,
                    )
                  }
                  onPress={() => {
                    void handleSearchAndLinkAgent();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.modalSubmitButton,

                    (
                      isSearching ||
                      actionUid
                    ) &&
                      styles.disabledButton,

                    pressed &&
                      !isSearching &&
                      !actionUid &&
                      styles.primaryButtonPressed,
                  ]}
                >
                  {isSearching ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.parchment100
                      }
                    />
                  ) : (
                    <Ionicons
                      name="person-add-outline"
                      size={18}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  )}

                  <Text
                    style={
                      styles.modalSubmitText
                    }
                  >
                    {isSearching
                      ? 'SEARCHING...'
                      : 'SEND LINK REQUEST'}
                  </Text>
                </Pressable>
              </FormScrollView>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    );
  };

export default SocialScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    keyboardContainer: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    screen: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    splitWrapper: {
      flex: 1,
      minHeight: 0,
      gap: 12,
    },

    headerIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 8,
    },

    headerTextContainer: {
      flex: 1,
      minWidth: 0,
    },

    /* ---------------------------------------------------------------------- */
    /* 60% Telegram panel                                                    */
    /* ---------------------------------------------------------------------- */

    telegramPanel: {
      flex: 0.6,
      minWidth: 0,
      minHeight: 0,
      padding: 14,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 7,
    },

    lightPanelHeader: {
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 10,
      paddingBottom: 9,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze600,
    },

    lightPanelTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 16,
      lineHeight: 22,
      fontWeight:
        '800',
      letterSpacing: 1.2,
    },

    lightPanelSubtitle: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.65,
      marginTop: 2,
    },

    callsignBadge: {
      maxWidth: 150,
      minHeight: 38,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 9,
      paddingVertical: 5,
      backgroundColor:
        COLOURS.forest800,
      borderRadius: 4,
    },

    callsignBadgeText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      letterSpacing: 0.4,
    },

    /* ---------------------------------------------------------------------- */
    /* Composer                                                              */
    /* ---------------------------------------------------------------------- */

    composerCard: {
      marginTop: 10,
      padding: 11,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    composerHeader: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      gap: 10,
      marginBottom: 5,
    },

    sectionTitleRowLight: {
      flex: 1,
      minWidth: 0,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
    },

    lightSectionTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 0.7,
    },

    characterCounter: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
    },

    composerDescription: {
      color:
        COLOURS.ink700,
      fontSize: 10,
      lineHeight: 15,
      marginBottom: 7,
    },

    telegramInput: {
      minHeight: 82,
      maxHeight: 120,
      paddingHorizontal: 10,
      paddingVertical: 9,
      color:
        COLOURS.ink900,
      backgroundColor:
        '#FFFDF5',
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
      fontFamily:
        MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
    },

    transmitButton: {
      minHeight: 50,
      marginTop: 8,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    transmitButtonText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.75,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Telegram feed                                                         */
    /* ---------------------------------------------------------------------- */

    dispatchFeedSection: {
      flex: 1,
      minHeight: 0,
      marginTop: 12,
    },

    feedHeader: {
      minHeight: 28,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 10,
      marginBottom: 6,
    },

    dispatchCount: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.4,
    },

    dispatchScroll: {
      flex: 1,
      minHeight: 0,
    },

    dispatchScrollContent: {
      gap: 7,
      paddingBottom: 4,
    },

    dispatchCard: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        '#CBBBA0',
      borderRadius: 5,
    },

    ownDispatchCard: {
      backgroundColor:
        '#E4D1A8',
      borderColor:
        COLOURS.rust700,
    },

    dispatchCardHeader: {
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 8,
      marginBottom: 4,
    },

    dispatchSenderRow: {
      flex: 1,
      minWidth: 0,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 5,
    },

    dispatchSender: {
      flexShrink: 1,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    ownDispatchSender: {
      color:
        COLOURS.rust800,
    },

    dispatchTime: {
      flexShrink: 0,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
    },

    dispatchText: {
      color:
        COLOURS.ink900,
      fontSize: 11,
      lineHeight: 17,
    },

    feedStateBox: {
      flex: 1,
      minHeight: 100,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 8,
      padding: 16,
      borderWidth: 1,
      borderStyle:
        'dashed',
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    feedStateText: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.5,
      textAlign:
        'center',
    },

    lightErrorCard: {
      minHeight: 50,
      marginBottom: 7,
      paddingHorizontal: 9,
      paddingVertical: 6,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 7,
      backgroundColor:
        '#F1D3C9',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
    },

    lightErrorText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 14,
      fontWeight:
        '700',
    },

    lightRetryButton: {
      minWidth: 66,
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 4,
    },

    lightRetryText: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '800',
    },

    lightPanelFooter: {
      minHeight: 27,
      justifyContent:
        'center',
      paddingTop: 7,
      marginTop: 7,
      borderTopWidth: 1,
      borderTopColor:
        COLOURS.bronze600,
    },

    lightPanelFooterText: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '700',
      letterSpacing: 0.45,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* 40% Network panel                                                     */
    /* ---------------------------------------------------------------------- */

    networkPanel: {
      flex: 0.4,
      minWidth: 0,
      minHeight: 0,
      padding: 12,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 7,
    },

    networkScroll: {
      flex: 1,
      minHeight: 0,
      marginBottom: 8,
    },

    networkScrollContent: {
      paddingBottom: 5,
    },

    darkPanelHeader: {
      minHeight: 50,
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      gap: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze500,
    },

    darkPanelTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      fontWeight:
        '800',
      letterSpacing: 0.9,
    },

    darkPanelSubtitle: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '700',
      letterSpacing: 0.5,
      marginTop: 2,
    },

    addExplorerButton: {
      width: 48,
      height: 48,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 24,
    },

    /* ---------------------------------------------------------------------- */
    /* Dark errors                                                           */
    /* ---------------------------------------------------------------------- */

    darkErrorCard: {
      marginTop: 9,
      padding: 8,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
      borderRadius: 5,
    },

    darkErrorText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      marginVertical: 5,
    },

    darkRetryButton: {
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      borderWidth: 1,
      borderColor:
        COLOURS.parchment100,
      borderRadius: 4,
    },

    darkRetryText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Network sections                                                      */
    /* ---------------------------------------------------------------------- */

    sectionHeaderRow: {
      minHeight: 27,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
      marginTop: 10,
      marginBottom: 6,
    },

    sectionSpacing: {
      marginTop: 14,
    },

    darkSectionTitle: {
      flexShrink: 1,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.7,
    },

    countBadge: {
      minWidth: 24,
      minHeight: 24,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 6,
      marginLeft: 'auto',
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 12,
    },

    countBadgeText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight:
        '800',
    },

    networkList: {
      gap: 6,
    },

    emptyDarkCard: {
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderWidth: 1,
      borderStyle:
        'dashed',
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    emptyDarkText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.45,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Location card                                                         */
    /* ---------------------------------------------------------------------- */

    locationCard: {
      padding: 9,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    locationStatusRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 8,
    },

    locationDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      flexShrink: 0,
    },

    locationDotReady: {
      backgroundColor:
        COLOURS.success300,
    },

    locationDotChecking: {
      backgroundColor:
        COLOURS.bronze400,
    },

    locationDotWarning: {
      backgroundColor:
        COLOURS.warning300,
    },

    locationStatusTextContainer: {
      flex: 1,
      minWidth: 0,
    },

    locationStatusTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
    },

    locationSharingText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '700',
      marginTop: 1,
    },

    locationPrivacyText: {
      color:
        COLOURS.parchment200,
      fontSize: 9,
      lineHeight: 14,
      marginTop: 7,
    },

    locationActions: {
      flexDirection:
        'row',
      gap: 6,
      marginTop: 8,
    },

    locationActionButton: {
      flex: 1,
      minHeight: 48,
      flexDirection:
        'row',
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 7,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 4,
    },

    locationActionText: {
      flexShrink: 1,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '800',
      textAlign:
        'center',
    },

    locationSettingsButton: {
      minWidth: 88,
      minHeight: 48,
      flexDirection:
        'row',
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 5,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 4,
    },

    locationSettingsText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Requests                                                              */
    /* ---------------------------------------------------------------------- */

    requestCard: {
      minHeight: 58,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 7,
      padding: 7,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    explorerIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 7,
    },

    explorerTextContainer: {
      flex: 1,
      minWidth: 0,
    },

    avatarDark: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
    },

    avatarDarkText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      fontWeight:
        '800',
    },

    requestName: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    requestMeta: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '700',
      marginTop: 1,
    },

    requestActionButton: {
      width: 48,
      height: 48,
      alignItems:
        'center',
      justifyContent:
        'center',
      borderRadius: 4,
    },

    acceptButton: {
      backgroundColor:
        COLOURS.success700,
    },

    declineButton: {
      backgroundColor:
        COLOURS.rust700,
    },

    inlineActions: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 5,
    },

    /* ---------------------------------------------------------------------- */
    /* Active links                                                          */
    /* ---------------------------------------------------------------------- */

    activeLinkCard: {
      minHeight: 56,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 7,
      padding: 7,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.success700,
      borderRadius: 5,
    },

    avatarLinked: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.success700,
      borderWidth: 1,
      borderColor:
        COLOURS.success300,
    },

    avatarLinkedText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      fontWeight:
        '800',
    },

    activeLinkName: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    activeLinkMeta: {
      color:
        COLOURS.success300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '700',
      marginTop: 1,
    },

    unlinkButton: {
      width: 48,
      height: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.parchment200,
      borderRadius: 4,
    },

    /* ---------------------------------------------------------------------- */
    /* Nearby                                                                */
    /* ---------------------------------------------------------------------- */

    nearbyDescription: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_FONT,
      fontSize: 7.5,
      lineHeight: 12,
      letterSpacing: 0.3,
      marginBottom: 6,
    },

    darkLoadingBox: {
      minHeight: 70,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 7,
      padding: 10,
    },

    darkLoadingText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.4,
      textAlign:
        'center',
    },

    nearbyCard: {
      minHeight: 58,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 7,
      padding: 7,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    avatarLight: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.forest800,
    },

    avatarLightText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      fontWeight:
        '800',
    },

    nearbyName: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    nearbyMeta: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '700',
      marginTop: 1,
    },

    compactActionButton: {
      width: 48,
      height: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#D7C8A9',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    statusActionButton: {
      minWidth: 64,
      minHeight: 48,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 4,
      paddingHorizontal: 7,
      borderWidth: 1,
      borderRadius: 4,
    },

    pendingButton: {
      backgroundColor:
        '#E4D1A8',
      borderColor:
        COLOURS.bronze600,
    },

    pendingButtonText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '800',
    },

    linkedButton: {
      backgroundColor:
        '#DDE9D8',
      borderColor:
        COLOURS.success700,
    },

    linkedButtonText: {
      color:
        COLOURS.success700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '800',
    },

    retryLinkButton: {
      backgroundColor:
        COLOURS.parchment100,
      borderColor:
        COLOURS.rust700,
    },

    retryLinkText: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '800',
    },

    blockedBadge: {
      minWidth: 68,
      minHeight: 48,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 4,
      paddingHorizontal: 6,
      backgroundColor:
        '#E7C9C0',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 4,
    },

    blockedText: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '800',
    },

    directoryNotice: {
      marginTop: 10,
      paddingTop: 7,
      borderTopWidth: 1,
      borderTopColor:
        'rgba(195, 160, 106, 0.38)',
    },

    directoryNoticeText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_FONT,
      fontSize: 7.5,
      lineHeight: 12,
      letterSpacing: 0.35,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Modal                                                                 */
    /* ---------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      padding: 20,
      backgroundColor:
        COLOURS.overlay,
    },

    modalDismissBackdrop: {
      position:
        'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },

    modalCard: {
      width: '90%',
      maxWidth: 560,
      padding: 16,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 8,
    },

    modalHeader: {
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'flex-start',
      justifyContent:
        'space-between',
      gap: 10,
      marginBottom: 10,
    },

    modalHeaderText: {
      flex: 1,
      minWidth: 0,
    },

    modalTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 14,
      lineHeight: 20,
      fontWeight:
        '800',
      letterSpacing: 0.9,
    },

    modalSubtitle: {
      color:
        COLOURS.ink700,
      fontSize: 10.5,
      lineHeight: 16,
      marginTop: 3,
    },

    modalCloseButton: {
      width: 48,
      height: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      borderRadius: 24,
    },

    searchErrorCard: {
      padding: 8,
      marginBottom: 9,
      backgroundColor:
        '#F1D3C9',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 4,
    },

    searchErrorText: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.4,
    },

    searchInputLabel: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.6,
      marginBottom: 5,
    },

    searchInput: {
      minHeight: 50,
      paddingHorizontal: 11,
      paddingVertical: 9,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_FONT,
      fontSize: 13,
      lineHeight: 19,
    },

    searchHelpText: {
      color:
        COLOURS.ink700,
      fontSize: 9.5,
      lineHeight: 14,
      marginTop: 5,
      marginBottom: 11,
    },

    modalSubmitButton: {
      minHeight: 50,
      flexDirection:
        'row',
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    modalSubmitText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.7,
    },

    /* ---------------------------------------------------------------------- */
    /* Interaction states                                                    */
    /* ---------------------------------------------------------------------- */

    disabledButton: {
      opacity: 0.48,
    },

    darkButtonPressed: {
      opacity: 0.78,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    primaryButtonPressed: {
      backgroundColor:
        COLOURS.rust600,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    lightButtonPressed: {
      opacity: 0.72,
    },
  });