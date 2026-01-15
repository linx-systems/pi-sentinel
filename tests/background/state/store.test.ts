import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {StateStore} from '~/background/state/store';
import browser from 'webextension-polyfill';

// Mock webextension-polyfill before importing StateStore
vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({}),
        },
    },
}));

describe('StateStore', () => {
    let store: StateStore;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset the mock to resolve successfully
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

        // Create a fresh instance for each test
        store = new StateStore();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getState', () => {
        it('should return initial state', () => {
            const state = store.getState();

            expect(state).toMatchObject({
                isConnected: false,
                connectionError: null,
                blockingEnabled: true,
                blockingTimer: null,
                stats: null,
                statsLastUpdated: 0,
                totpRequired: false,
            });
        });

        it('should return immutable copy of state', () => {
            const state1 = store.getState();
            const state2 = store.getState();

            expect(state1).not.toBe(state2);
            expect(state1).toEqual(state2);
        });
    });

    describe('setState', () => {
        it('should update state with partial values', () => {
            store.setState({isConnected: true});

            const state = store.getState();
            expect(state.isConnected).toBe(true);
        });

        it('should merge with existing state', () => {
            store.setState({isConnected: true});
            store.setState({blockingEnabled: false});

            const state = store.getState();
            expect(state.isConnected).toBe(true);
            expect(state.blockingEnabled).toBe(false);
        });

        it('should broadcast state update', () => {
            store.setState({isConnected: true});

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'STATE_UPDATED',
                payload: expect.objectContaining({
                    isConnected: true,
                }),
            });
        });

        it('should notify listeners', () => {
            const listener = vi.fn();
            store.subscribe(listener);

            store.setState({isConnected: true});

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({isConnected: true})
            );
        });
    });

    describe('reset', () => {
        it('should reset state to initial values', () => {
            store.setState({isConnected: true, blockingEnabled: false});

            store.reset();

            const state = store.getState();
            expect(state.isConnected).toBe(false);
            expect(state.blockingEnabled).toBe(true);
        });

        it('should clear all tab domains', () => {
            store.initTabDomains(1, 'https://example.com', 'example.com');

            store.reset();

            const tabDomains = store.getTabDomains(1);
            expect(tabDomains).toBeNull();
        });
    });

    describe('subscribe', () => {
        it('should add listener and call on state change', () => {
            const listener = vi.fn();
            store.subscribe(listener);

            store.setState({isConnected: true});

            expect(listener).toHaveBeenCalled();
        });

        it('should return unsubscribe function', () => {
            const listener = vi.fn();
            const unsubscribe = store.subscribe(listener);

            unsubscribe();
            store.setState({isConnected: true});

            expect(listener).not.toHaveBeenCalled();
        });

        it('should handle multiple listeners', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            store.subscribe(listener1);
            store.subscribe(listener2);

            store.setState({isConnected: true});

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });

        it('should catch and log listener errors', () => {
            const errorListener = vi.fn().mockImplementation(() => {
                throw new Error('Listener error');
            });
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
            });

            store.subscribe(errorListener);
            store.setState({isConnected: true});

            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('tab domain tracking', () => {
        describe('initTabDomains', () => {
            it('should initialize domain tracking for a tab', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');

                const tabDomains = store.getTabDomains(1);
                expect(tabDomains).toMatchObject({
                    tabId: 1,
                    pageUrl: 'https://example.com',
                    firstPartyDomain: 'example.com',
                });
                expect(tabDomains?.domains.has('example.com')).toBe(true);
            });
        });

        describe('addTabDomain', () => {
            it('should add domain to existing tab', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');

                store.addTabDomain(1, 'api.example.com');

                const tabDomains = store.getTabDomains(1);
                expect(tabDomains?.domains.has('api.example.com')).toBe(true);
            });

            it('should identify third-party domains', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');

                store.addTabDomain(1, 'tracker.com');

                const tabDomains = store.getTabDomains(1);
                expect(tabDomains?.thirdPartyDomains.has('tracker.com')).toBe(true);
            });

            it('should not mark same-site subdomains as third-party', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');

                store.addTabDomain(1, 'api.example.com');
                store.addTabDomain(1, 'cdn.example.com');

                const tabDomains = store.getTabDomains(1);
                expect(tabDomains?.thirdPartyDomains.size).toBe(0);
            });

            it('should broadcast update for new domains', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');
                vi.clearAllMocks();

                store.addTabDomain(1, 'tracker.com');

                expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                    type: 'TAB_DOMAINS_UPDATED',
                    payload: expect.objectContaining({
                        tabId: 1,
                        domains: expect.arrayContaining(['tracker.com']),
                    }),
                });
            });

            it('should not broadcast update for duplicate domains', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');
                store.addTabDomain(1, 'tracker.com');
                vi.clearAllMocks();

                store.addTabDomain(1, 'tracker.com');

                expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
            });

            it('should do nothing if tab not initialized', () => {
                store.addTabDomain(999, 'example.com');

                const tabDomains = store.getTabDomains(999);
                expect(tabDomains).toBeNull();
            });
        });

        describe('clearTabDomains', () => {
            it('should clear domain tracking for a tab', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');

                store.clearTabDomains(1);

                const tabDomains = store.getTabDomains(1);
                expect(tabDomains).toBeNull();
            });
        });

        describe('getAllTrackedTabs', () => {
            it('should return all tracked tab IDs', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');
                store.initTabDomains(2, 'https://test.com', 'test.com');
                store.initTabDomains(3, 'https://other.com', 'other.com');

                const tabs = store.getAllTrackedTabs();

                expect(tabs).toEqual(expect.arrayContaining([1, 2, 3]));
                expect(tabs.length).toBe(3);
            });

            it('should return empty array if no tabs tracked', () => {
                const tabs = store.getAllTrackedTabs();

                expect(tabs).toEqual([]);
            });
        });

        describe('getSerializableTabDomains', () => {
            it('should convert Sets to Arrays', () => {
                store.initTabDomains(1, 'https://example.com', 'example.com');
                store.addTabDomain(1, 'tracker.com');

                const serializable = store.getSerializableTabDomains(1);

                expect(Array.isArray(serializable?.domains)).toBe(true);
                expect(Array.isArray(serializable?.thirdPartyDomains)).toBe(true);
                expect(serializable?.domains).toContain('example.com');
                expect(serializable?.thirdPartyDomains).toContain('tracker.com');
            });

            it('should return null for non-existent tab', () => {
                const serializable = store.getSerializableTabDomains(999);

                expect(serializable).toBeNull();
            });
        });
    });
});
