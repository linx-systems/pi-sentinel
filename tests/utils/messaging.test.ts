import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Message, MessageResponse} from '~/utils/messaging';
import {sendMessage} from '~/utils/messaging';

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

describe('messaging', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('sendMessage', () => {
        it('should send GET_STATE message', async () => {
            const mockResponse: MessageResponse = {
                success: true,
                data: {
                    isConnected: true,
                    blockingEnabled: true,
                    stats: null,
                },
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {type: 'GET_STATE'};
            const response = await sendMessage(message);

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
            expect(response).toEqual(mockResponse);
        });

        it('should send AUTHENTICATE message with payload', async () => {
            const mockResponse: MessageResponse = {
                success: true,
                data: {totpRequired: false},
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {
                type: 'AUTHENTICATE',
                payload: {password: 'test-password'},
            };
            const response = await sendMessage(message);

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
            expect(response).toEqual(mockResponse);
        });

        it('should send SET_BLOCKING message with timer', async () => {
            const mockResponse: MessageResponse = {
                success: true,
                data: {
                    blocking: 'disabled',
                    timer: 300,
                },
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {
                type: 'SET_BLOCKING',
                payload: {enabled: false, timer: 300},
            };
            const response = await sendMessage(message);

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
            expect(response).toEqual(mockResponse);
        });

        it('should send ADD_TO_ALLOWLIST message', async () => {
            const mockResponse: MessageResponse = {
                success: true,
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {
                type: 'ADD_TO_ALLOWLIST',
                payload: {domain: 'example.com', comment: 'Test domain'},
            };
            const response = await sendMessage(message);

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
            expect(response.success).toBe(true);
        });

        it('should handle error responses', async () => {
            const mockResponse: MessageResponse = {
                success: false,
                error: 'Authentication failed',
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {
                type: 'AUTHENTICATE',
                payload: {password: 'wrong-password'},
            };
            const response = await sendMessage(message);

            expect(response.success).toBe(false);
            expect(response.error).toBe('Authentication failed');
        });

        it('should send GET_QUERIES message with optional payload', async () => {
            const mockResponse: MessageResponse = {
                success: true,
                data: [],
            };

            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue(mockResponse);

            const message: Message = {
                type: 'GET_QUERIES',
                payload: {length: 100, from: 0},
            };
            const response = await sendMessage(message);

            expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
            expect(response.success).toBe(true);
        });
    });
});
