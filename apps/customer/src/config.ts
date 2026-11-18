/** The API address. Set EXPO_PUBLIC_API_URL for anything other than a local developer machine. */
export const apiUrl: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** The realtime socket lives on the same host: http becomes ws, https becomes wss. */
export const realtimeUrl = `${apiUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/v1/realtime`;

/** The delivery pin until the map arrives in Plan 05: the Chapainawabganj town centre. */
export const TOWN_CENTRE = { lat: 24.5965, lng: 88.2775 } as const;

/** Where the "Partner with Oregano" and "Ride with Oregano" links lead. Set these for anything but a developer machine. */
export const restaurantAppUrl: string = process.env.EXPO_PUBLIC_RESTAURANT_APP_URL ?? 'http://localhost:8082';
export const riderAppUrl: string = process.env.EXPO_PUBLIC_RIDER_APP_URL ?? 'http://localhost:8083';
