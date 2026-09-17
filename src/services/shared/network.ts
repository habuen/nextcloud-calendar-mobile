import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';

let online = true;
const listeners = new Set<() => void>();

function isOnlineState(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

function set(value: boolean): void {
  if (value === online) return;
  online = value;
  listeners.forEach((l) => l());
}

function refresh(): void {
  Network.getNetworkStateAsync()
    .then((state) => set(isOnlineState(state)))
    .catch(() => undefined);
}

export function setupOnlineManager(): () => void {
  refresh();
  const sub = Network.addNetworkStateListener((state) => set(isOnlineState(state)));
  // Android can freeze a backgrounded app's native listeners under battery
  // optimization/Doze, so a connectivity change that happens while backgrounded
  // may never reach `sub` above. Re-checking on every return to the foreground
  // stops the offline banner from getting stuck on a stale pre-freeze state.
  const appStateSub = AppState.addEventListener('change', (status) => {
    if (status === 'active') refresh();
  });
  return () => {
    sub.remove();
    appStateSub.remove();
  };
}

export function getIsOnline(): boolean {
  return online;
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => online,
    () => true,
  );
}
