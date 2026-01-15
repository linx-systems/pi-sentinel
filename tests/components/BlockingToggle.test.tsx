import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/preact';
import {act} from 'preact/test-utils';
import {BlockingToggle} from '~/entrypoints/popup/components/BlockingToggle';

// Mock browser API
vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

describe('BlockingToggle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('rendering', () => {
        it('should show "Blocking Active" when enabled', () => {
            render(<BlockingToggle enabled={true} timer={null}/>);

            expect(screen.getByText('Blocking Active')).toBeTruthy();
        });

        it('should show "Blocking Disabled" when disabled', () => {
            render(<BlockingToggle enabled={false} timer={null}/>);

            expect(screen.getByText('Blocking Disabled')).toBeTruthy();
        });

        it('should apply active class when enabled', () => {
            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            const button = container.querySelector('.toggle');
            expect(button?.classList.contains('active')).toBe(true);
        });

        it('should apply disabled-state class when disabled', () => {
            const {container} = render(<BlockingToggle enabled={false} timer={null}/>);

            const button = container.querySelector('.toggle');
            expect(button?.classList.contains('disabled-state')).toBe(true);
        });
    });

    describe('timer display', () => {
        it('should show remaining time when disabled with timer', () => {
            render(<BlockingToggle enabled={false} timer={300}/>);

            expect(screen.getByText('5m remaining')).toBeTruthy();
        });

        it('should format seconds correctly', () => {
            render(<BlockingToggle enabled={false} timer={45}/>);

            expect(screen.getByText('45s remaining')).toBeTruthy();
        });

        it('should format minutes correctly', () => {
            render(<BlockingToggle enabled={false} timer={120}/>);

            expect(screen.getByText('2m remaining')).toBeTruthy();
        });

        it('should format hours correctly', () => {
            render(<BlockingToggle enabled={false} timer={7200}/>);

            expect(screen.getByText('2h remaining')).toBeTruthy();
        });

        it('should not show timer when enabled', () => {
            const {container} = render(<BlockingToggle enabled={true} timer={300}/>);

            const timerInfo = container.querySelector('.timer-info');
            expect(timerInfo).toBeFalsy();
        });

        it('should not show timer when timer is null', () => {
            const {container} = render(<BlockingToggle enabled={false} timer={null}/>);

            const timerInfo = container.querySelector('.timer-info');
            expect(timerInfo).toBeFalsy();
        });
    });

    describe('timer countdown', () => {
        it('should count down timer every second', async () => {
            render(<BlockingToggle enabled={false} timer={10}/>);

            expect(screen.getByText('10s remaining')).toBeTruthy();

            // Advance time by 1 second and wait for state update
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            await waitFor(() => {
                expect(screen.getByText('9s remaining')).toBeTruthy();
            }, {timeout: 100});

            // Advance another second
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            await waitFor(() => {
                expect(screen.getByText('8s remaining')).toBeTruthy();
            }, {timeout: 100});
        });

        it('should stop countdown at 0', async () => {
            render(<BlockingToggle enabled={false} timer={2}/>);

            vi.advanceTimersByTime(3000);
            await waitFor(() => {
                const timerInfo = screen.queryByText(/remaining/);
                expect(timerInfo).toBeFalsy();
            });
        });

        it('should not countdown when enabled', async () => {
            render(<BlockingToggle enabled={true} timer={10}/>);

            vi.advanceTimersByTime(5000);

            const timerInfo = screen.queryByText(/remaining/);
            expect(timerInfo).toBeFalsy();
        });
    });

    describe('toggle functionality', () => {
        it('should show timer options when clicking toggle while enabled', async () => {
            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            await waitFor(() => {
                expect(screen.getByText('Disable for:')).toBeTruthy();
            });
        });

        it('should send message to enable blocking when clicking while disabled', async () => {
            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

            const {container} = render(<BlockingToggle enabled={false} timer={null}/>);

            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            await waitFor(() => {
                expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                    type: 'SET_BLOCKING',
                    payload: {enabled: true},
                });
            });
        });

        it('should disable button while loading', async () => {
            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockImplementation(
                () => new Promise((resolve) => setTimeout(resolve, 100))
            );

            const {container} = render(<BlockingToggle enabled={false} timer={null}/>);

            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            expect(toggleButton.hasAttribute('disabled')).toBe(true);
        });
    });

    describe('timer selection', () => {
        it('should render all timer options', async () => {
            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            await waitFor(() => {
                expect(screen.getByText('30 seconds')).toBeTruthy();
                expect(screen.getByText('1 minute')).toBeTruthy();
                expect(screen.getByText('5 minutes')).toBeTruthy();
                expect(screen.getByText('30 minutes')).toBeTruthy();
                expect(screen.getByText('1 hour')).toBeTruthy();
                expect(screen.getByText('Indefinitely')).toBeTruthy();
            });
        });

        it('should send disable message with timer value', async () => {
            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            // Show timer options
            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            // Click on 5 minutes option
            await waitFor(() => {
                const fiveMinButton = screen.getByText('5 minutes');
                fireEvent.click(fiveMinButton);
            });

            await waitFor(() => {
                expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                    type: 'SET_BLOCKING',
                    payload: {enabled: false, timer: 300},
                });
            });
        });

        it('should send disable message without timer for Indefinitely', async () => {
            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            // Show timer options
            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            // Click on Indefinitely option
            await waitFor(() => {
                const indefinitelyButton = screen.getByText('Indefinitely');
                fireEvent.click(indefinitelyButton);
            });

            await waitFor(() => {
                expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                    type: 'SET_BLOCKING',
                    payload: {enabled: false, timer: undefined},
                });
            });
        });

        it('should hide timer options after selection', async () => {
            const browser = (await import('webextension-polyfill')).default;
            vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

            const {container} = render(<BlockingToggle enabled={true} timer={null}/>);

            const toggleButton = container.querySelector('.toggle') as HTMLElement;
            fireEvent.click(toggleButton);

            await waitFor(() => {
                const oneMinButton = screen.getByText('1 minute');
                fireEvent.click(oneMinButton);
            });

            await waitFor(() => {
                expect(screen.queryByText('Disable for:')).toBeFalsy();
            });
        });
    });
});
