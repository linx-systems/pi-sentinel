import browser from 'webextension-polyfill';
import { apiClient } from './api/client';
import { authManager } from './api/auth';
import { store } from './state/store';
import { badgeService } from './services/badge';
import { notificationService } from './services/notifications';
import { domainTracker } from './services/domain-tracker';
import { ALARMS, DEFAULTS } from '../shared/constants';
import type { Message, MessageResponse } from '../shared/messaging';
import type { ExtensionState } from '../shared/types';

/**
 * PiSentinel Background Script
 *
 * This is the main entry point for the extension's background logic.
 * It runs as a Firefox event page and handles:
 * - Message routing from popup/sidebar/options
 * - Session management and keepalive
 * - Stats polling
 * - Domain tracking coordination
 */

// ===== Initialization =====

async function initialize(): Promise<void> {
  try {
    console.log('[PiSentinel] Starting background script initialization');

    // Initialize services
    console.log('[PiSentinel] Initializing notification service');
    await notificationService.initialize();

    console.log('[PiSentinel] Initializing domain tracker');
    domainTracker.initialize();

    // Set up auth re-authentication handler
    console.log('[PiSentinel] Setting up auth handler');
    apiClient.setAuthRequiredHandler(async () => {
      const password = await authManager.getDecryptedPassword();
      if (password) {
        const result = await authManager.authenticate(password);
        return result.success;
      }
      return false;
    });

    // Try to restore session
    console.log('[PiSentinel] Attempting to restore session');
    const hasSession = await authManager.initialize();
    if (hasSession) {
      console.log('[PiSentinel] Session restored successfully');
      store.setState({ isConnected: true });
      await refreshStats();
    } else {
      console.log('[PiSentinel] No session to restore');
    }

    // Subscribe to state changes for badge updates
    console.log('[PiSentinel] Setting up state subscription');
    store.subscribe((state) => {
      badgeService.update(state);
    });

    // Initial badge update
    await badgeService.update(store.getState());

    console.log('[PiSentinel] Background script initialized successfully');
  } catch (error) {
    console.error('[PiSentinel] Initialization error (message listener will still work):', error);
    // Don't re-throw - allow message listener to still function
  }
}

// ===== Message Handling =====

async function handleMessage(
  message: Message,
  _sender: browser.Runtime.MessageSender
): Promise<MessageResponse<unknown>> {
  console.log('[Background] handleMessage called with type:', message.type);
  try {
    switch (message.type) {
      case 'AUTHENTICATE':
        return await handleAuthenticate(message.payload);

      case 'LOGOUT':
        return await handleLogout();

      case 'GET_STATE':
        return { success: true, data: store.getState() };

      case 'GET_STATS':
        return await handleGetStats();

      case 'GET_BLOCKING_STATUS':
        return await handleGetBlockingStatus();

      case 'SET_BLOCKING':
        return await handleSetBlocking(message.payload);

      case 'GET_TAB_DOMAINS':
        return handleGetTabDomains(message.payload.tabId);

      case 'ADD_TO_ALLOWLIST':
        return await handleAddDomain(message.payload.domain, 'allow', message.payload.comment);

      case 'ADD_TO_DENYLIST':
        return await handleAddDomain(message.payload.domain, 'deny', message.payload.comment);

      case 'REMOVE_FROM_ALLOWLIST':
        return await handleRemoveDomain(message.payload.domain, 'allow');

      case 'REMOVE_FROM_DENYLIST':
        return await handleRemoveDomain(message.payload.domain, 'deny');

      case 'SEARCH_DOMAIN':
        return await handleSearchDomain(message.payload.domain);

      case 'GET_QUERIES':
        return await handleGetQueries(message.payload);

      case 'SAVE_CONFIG':
        return await handleSaveConfig(message.payload);

      case 'TEST_CONNECTION':
        return await handleTestConnection(message.payload.url);

      case 'HEALTH_CHECK':
        return {
          success: true,
          data: {
            ready: true,
            timestamp: Date.now(),
            version: '0.0.1'
          }
        };

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Background] Message handler error:', error);
    return { success: false, error: errorMessage };
  } finally {
    console.log('[Background] handleMessage completed for type:', message.type);
  }
}

// ===== Message Handlers =====

async function handleAuthenticate(payload: {
  password: string;
  totp?: string;
}): Promise<MessageResponse<{ totpRequired?: boolean }>> {
  const result = await authManager.authenticate(payload.password, payload.totp);

  if (result.success) {
    store.setState({ isConnected: true, connectionError: null, totpRequired: false });
    await refreshStats();
    await startStatsPolling();
    return { success: true };
  }

  if (result.totpRequired) {
    store.setState({ totpRequired: true });
    return { success: false, data: { totpRequired: true }, error: 'TOTP required' };
  }

  store.setState({ isConnected: false, connectionError: result.error || null });
  return { success: false, error: result.error };
}

async function handleLogout(): Promise<MessageResponse<void>> {
  await authManager.logout();
  await stopStatsPolling();
  store.reset();
  await badgeService.clear();

  // Clean up storage-based communication artifacts
  await browser.storage.local.remove([
    'authResponse',
    'configResponse',
    'logoutResponse',
    'testConnectionResponse',
    'pendingAuth',
    'pendingConfig',
    'pendingLogout',
    'pendingTestConnection',
  ]);

  return { success: true };
}

async function handleGetStats(): Promise<MessageResponse<ExtensionState['stats']>> {
  const result = await apiClient.getStats();
  if (result.success && result.data) {
    store.setState({
      stats: result.data,
      statsLastUpdated: Date.now(),
    });
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error?.message };
}

async function handleGetBlockingStatus(): Promise<
  MessageResponse<{ blocking: boolean; timer: number | null }>
> {
  const result = await apiClient.getBlockingStatus();
  if (result.success && result.data) {
    const enabled = result.data.blocking === 'enabled';
    store.setState({
      blockingEnabled: enabled,
      blockingTimer: result.data.timer,
    });
    return {
      success: true,
      data: { blocking: enabled, timer: result.data.timer },
    };
  }
  return { success: false, error: result.error?.message };
}

async function handleSetBlocking(payload: {
  enabled: boolean;
  timer?: number;
}): Promise<MessageResponse<{ blocking: boolean; timer: number | null }>> {
  const result = await apiClient.setBlocking(payload.enabled, payload.timer);

  if (result.success && result.data) {
    const enabled = result.data.blocking === 'enabled';
    store.setState({
      blockingEnabled: enabled,
      blockingTimer: result.data.timer,
    });

    // Show notification
    if (enabled) {
      await notificationService.showBlockingEnabled();
    } else {
      await notificationService.showBlockingDisabled(payload.timer);
    }

    return {
      success: true,
      data: { blocking: enabled, timer: result.data.timer },
    };
  }

  return { success: false, error: result.error?.message };
}

function handleGetTabDomains(
  tabId: number
): MessageResponse<ReturnType<typeof store.getSerializableTabDomains>> {
  const data = store.getSerializableTabDomains(tabId);
  return { success: true, data };
}

async function handleAddDomain(
  domain: string,
  listType: 'allow' | 'deny',
  comment?: string
): Promise<MessageResponse<void>> {
  const result = await apiClient.addDomain(domain, listType, 'exact', comment);

  if (result.success) {
    await notificationService.showDomainAdded(domain, listType);
    return { success: true };
  }

  return { success: false, error: result.error?.message };
}

async function handleRemoveDomain(
  domain: string,
  listType: 'allow' | 'deny'
): Promise<MessageResponse<void>> {
  const result = await apiClient.removeDomain(domain, listType, 'exact');
  return result.success ? { success: true } : { success: false, error: result.error?.message };
}

async function handleSearchDomain(
  domain: string
): Promise<MessageResponse<{ gravity: boolean; allowlist: boolean; denylist: boolean }>> {
  const result = await apiClient.searchDomain(domain);

  if (result.success && result.data) {
    const data = result.data as unknown as Record<string, unknown>;
    console.log('Search API response:', JSON.stringify(data, null, 2));

    // Handle Pi-hole v6 API response structure
    // API returns: { search: { domains: [...], gravity: [...] } }
    const searchData = (data.search as Record<string, unknown>) || data;
    const gravity = searchData.gravity;
    const domains = searchData.domains as unknown[];

    // gravity is an array of matching blocklist entries
    const gravityCount = Array.isArray(gravity) ? gravity.length : 0;

    // domains is an array - check for allow/deny entries
    const allowlist = Array.isArray(domains) ? domains.filter((d: any) => d.type === 'allow') : [];
    const denylist = Array.isArray(domains) ? domains.filter((d: any) => d.type === 'deny') : [];

    return {
      success: true,
      data: {
        gravity: gravityCount > 0,
        allowlist: allowlist.length > 0,
        denylist: denylist.length > 0,
      },
    };
  }

  return { success: false, error: result.error?.message };
}

async function handleGetQueries(payload?: {
  length?: number;
  from?: number;
}): Promise<MessageResponse<unknown>> {
  const result = await apiClient.getQueries(payload);
  return result.success ? { success: true, data: result.data } : { success: false, error: result.error?.message };
}

async function handleSaveConfig(payload: {
  piholeUrl: string;
  password: string;
  notificationsEnabled?: boolean;
  refreshInterval?: number;
  rememberPassword?: boolean;
}): Promise<MessageResponse<void>> {
  try {
    await authManager.saveConfig(payload.piholeUrl, payload.password, {
      notificationsEnabled: payload.notificationsEnabled,
      refreshInterval: payload.refreshInterval,
      rememberPassword: payload.rememberPassword,
    });

    notificationService.setEnabled(payload.notificationsEnabled ?? true);
    return { success: true };
  } catch (error) {
    console.error('[Background] Error in handleSaveConfig:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save config',
    };
  }
}

async function handleTestConnection(url: string): Promise<MessageResponse<void>> {
  const result = await apiClient.testConnection(url);
  return result.success ? { success: true } : { success: false, error: result.error?.message };
}

// ===== Stats Polling =====

async function refreshStats(): Promise<void> {
  const result = await apiClient.getStats();
  if (result.success && result.data) {
    store.setState({
      stats: result.data,
      statsLastUpdated: Date.now(),
    });
  }

  // Also refresh blocking status
  const blockingResult = await apiClient.getBlockingStatus();
  if (blockingResult.success && blockingResult.data) {
    store.setState({
      blockingEnabled: blockingResult.data.blocking === 'enabled',
      blockingTimer: blockingResult.data.timer,
    });
  }
}

async function startStatsPolling(): Promise<void> {
  const config = await authManager.getConfig();
  const interval = config?.refreshInterval || DEFAULTS.REFRESH_INTERVAL;

  await browser.alarms.create(ALARMS.STATS_REFRESH, {
    periodInMinutes: interval / 60, // Convert seconds to minutes
  });
}

async function stopStatsPolling(): Promise<void> {
  await browser.alarms.clear(ALARMS.STATS_REFRESH);
}

// ===== Alarm Handling =====

async function handleAlarm(alarm: browser.Alarms.Alarm): Promise<void> {
  switch (alarm.name) {
    case ALARMS.SESSION_KEEPALIVE:
      // First, try proactive renewal if session is about to expire
      const renewalSuccess = await authManager.renewSessionBeforeExpiry();
      if (renewalSuccess) {
        // Session renewed or still valid
        break;
      }

      // Fall back to regular keepalive
      const sessionValid = await authManager.handleKeepalive();
      if (!sessionValid) {
        // Session expired and couldn't be renewed
        // Try auto-reauthentication if Remember Password is enabled
        const password = await authManager.getDecryptedPassword();
        if (password) {
          const result = await authManager.authenticate(password);
          if (result.success) {
            store.setState({ isConnected: true });
            break;
          }
        }

        store.setState({ isConnected: false });
        await notificationService.showConnectionError('Session expired');
      }
      break;

    case ALARMS.STATS_REFRESH:
      if (await authManager.hasValidSession()) {
        await refreshStats();
      }
      break;
  }
}

// ===== Event Listeners =====

// Register message listener at top level (required for event pages)
console.log('[Background] Registering message listener');

// Use Chrome/Firefox compatible sendResponse pattern
browser.runtime.onMessage.addListener(
  (message: unknown, sender: browser.Runtime.MessageSender, sendResponse: (response: any) => void) => {
    console.log('[Background] Listener received message:', message);

    // Handle async with sendResponse callback
    handleMessage(message as Message, sender)
      .then((response) => {
        console.log('[Background] Calling sendResponse with:', response);
        sendResponse(response);
      })
      .catch((error) => {
        console.error('[Background] Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      });

    // CRITICAL: Return true to indicate we will call sendResponse asynchronously
    return true;
  }
);
console.log('[Background] Message listener registered');

// Register alarm listener at top level
browser.alarms.onAlarm.addListener(handleAlarm);

// WORKAROUND: Listen for storage changes for config saves and auth (browser.runtime.sendMessage is broken)
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local') {
    // Handle config saves
    if (changes.pendingConfig) {
      const config = changes.pendingConfig.newValue as { piholeUrl: string; password: string; rememberPassword?: boolean; timestamp: number } | undefined;
      if (config) {
        console.log('[Background] Received config via storage:', config);
        try {
          const response = await handleSaveConfig({
            piholeUrl: config.piholeUrl,
            password: config.password,
            rememberPassword: config.rememberPassword,
          });
          console.log('[Background] Sending response via storage:', response);
          await browser.storage.local.set({ configResponse: response });
          // Clean up
          await browser.storage.local.remove('pendingConfig');
        } catch (error) {
          console.error('[Background] Error processing config:', error);
          await browser.storage.local.set({
            configResponse: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    }

    // Handle authentication
    if (changes.pendingAuth) {
      const auth = changes.pendingAuth.newValue as { password: string; totp?: string; timestamp: number } | undefined;
      if (auth) {
        console.log('[Background] Received auth via storage');
        try {
          const response = await handleAuthenticate({
            password: auth.password,
            totp: auth.totp,
          });
          console.log('[Background] Sending auth response via storage:', response);
          await browser.storage.local.set({ authResponse: response });
          // Clean up
          await browser.storage.local.remove('pendingAuth');
        } catch (error) {
          console.error('[Background] Error processing auth:', error);
          await browser.storage.local.set({
            authResponse: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    }

    // Handle test connection
    if (changes.pendingTestConnection) {
      const test = changes.pendingTestConnection.newValue as { url: string; timestamp: number } | undefined;
      if (test) {
        console.log('[Background] Received test connection via storage');
        try {
          const response = await handleTestConnection(test.url);
          console.log('[Background] Sending test response via storage:', response);
          await browser.storage.local.set({ testConnectionResponse: response });
          // Clean up
          await browser.storage.local.remove('pendingTestConnection');
        } catch (error) {
          console.error('[Background] Error processing test:', error);
          await browser.storage.local.set({
            testConnectionResponse: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    }

    // Handle logout
    if (changes.pendingLogout) {
      const logout = changes.pendingLogout.newValue as { timestamp: number } | undefined;
      if (logout) {
        console.log('[Background] Received logout via storage');
        try {
          const response = await handleLogout();
          console.log('[Background] Sending logout response via storage:', response);
          await browser.storage.local.set({ logoutResponse: response });
          // Clean up
          await browser.storage.local.remove('pendingLogout');
        } catch (error) {
          console.error('[Background] Error processing logout:', error);
          await browser.storage.local.set({
            logoutResponse: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    }
  }
});

// Initialize on startup
browser.runtime.onStartup.addListener(initialize);

// Initialize on install
browser.runtime.onInstalled.addListener(async (details) => {
  console.log('PiSentinel: Extension installed/updated', details.reason);
  await initialize();
});

// Also initialize immediately for development reloads
initialize().catch(console.error);
