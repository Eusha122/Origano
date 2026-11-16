/** The API address. Set EXPO_PUBLIC_API_URL for anything other than a local developer machine. */
export const apiUrl: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** The realtime socket lives on the same host: http becomes ws, https becomes wss. */
export const realtimeUrl = `${apiUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/v1/realtime`;
