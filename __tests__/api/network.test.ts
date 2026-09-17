import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { setupOnlineManager, getIsOnline } from '../../src/services/shared/network';

jest.mock('expo-network', () => ({
  __esModule: true,
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
}));

jest.mock('react-native', () => ({
  __esModule: true,
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

const addNetworkStateListener = Network.addNetworkStateListener as unknown as jest.Mock;
const getNetworkStateAsync = Network.getNetworkStateAsync as unknown as jest.Mock;
const addAppStateListener = AppState.addEventListener as unknown as jest.Mock;

function lastNetworkCallback(): (state: any) => void {
  const calls = addNetworkStateListener.mock.calls;
  return calls[calls.length - 1][0];
}

function lastAppStateCallback(): (status: string) => void {
  const calls = addAppStateListener.mock.calls;
  return calls[calls.length - 1][1];
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('setupOnlineManager', () => {
  afterEach(() => {
    addNetworkStateListener.mockClear();
  });

  it('reports online when connected and the internet is reachable', () => {
    setupOnlineManager();
    lastNetworkCallback()({ isConnected: true, isInternetReachable: true });
    expect(getIsOnline()).toBe(true);
  });

  it('reports offline when not connected', () => {
    setupOnlineManager();
    lastNetworkCallback()({ isConnected: false, isInternetReachable: false });
    expect(getIsOnline()).toBe(false);
  });

  it('reports offline when connected but the internet is unreachable', () => {
    setupOnlineManager();
    lastNetworkCallback()({ isConnected: true, isInternetReachable: false });
    expect(getIsOnline()).toBe(false);
  });

  it('treats unknown reachability (undefined) as online', () => {
    setupOnlineManager();
    lastNetworkCallback()({ isConnected: false, isInternetReachable: false });
    lastNetworkCallback()({ isConnected: true });
    expect(getIsOnline()).toBe(true);
  });

  it('re-checks connectivity when the app returns to the foreground', async () => {
    setupOnlineManager();
    await flush(); // settle setupOnlineManager's own initial check first
    lastNetworkCallback()({ isConnected: false, isInternetReachable: false });
    expect(getIsOnline()).toBe(false);

    // A connectivity change happened while backgrounded and the app's native
    // listener was frozen for it (the scenario this exists for) — nothing
    // updates `online` until the foreground re-check below runs.
    getNetworkStateAsync.mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
    lastAppStateCallback()('active');
    await flush();

    expect(getIsOnline()).toBe(true);
  });

  it('does not re-check on a transition to background/inactive', async () => {
    setupOnlineManager();
    await flush(); // settle setupOnlineManager's own initial check first
    lastNetworkCallback()({ isConnected: false, isInternetReachable: false });

    getNetworkStateAsync.mockClear();
    lastAppStateCallback()('background');
    await flush();

    expect(getNetworkStateAsync).not.toHaveBeenCalled();
    expect(getIsOnline()).toBe(false);
  });

  it('tears down both the network and app-state subscriptions on cleanup', () => {
    const networkRemove = jest.fn();
    const appStateRemove = jest.fn();
    addNetworkStateListener.mockReturnValueOnce({ remove: networkRemove });
    addAppStateListener.mockReturnValueOnce({ remove: appStateRemove });

    const teardown = setupOnlineManager();
    teardown();

    expect(networkRemove).toHaveBeenCalledTimes(1);
    expect(appStateRemove).toHaveBeenCalledTimes(1);
  });
});
