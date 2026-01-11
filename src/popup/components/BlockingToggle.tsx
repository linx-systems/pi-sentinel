import { useState } from 'preact/hooks';
import browser from 'webextension-polyfill';
import { DISABLE_TIMERS } from '../../shared/constants';

interface BlockingToggleProps {
  enabled: boolean;
  timer: number | null;
}

export function BlockingToggle({ enabled, timer }: BlockingToggleProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showTimers, setShowTimers] = useState(false);

  const handleToggle = async () => {
    if (enabled) {
      // Show timer options when disabling
      setShowTimers(true);
    } else {
      // Re-enable blocking
      setIsLoading(true);
      try {
        await browser.runtime.sendMessage({
          type: 'SET_BLOCKING',
          payload: { enabled: true },
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDisableWithTimer = async (seconds: number) => {
    setIsLoading(true);
    setShowTimers(false);
    try {
      await browser.runtime.sendMessage({
        type: 'SET_BLOCKING',
        payload: { enabled: false, timer: seconds || undefined },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimer = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s remaining`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m remaining`;
    return `${Math.round(seconds / 3600)}h remaining`;
  };

  return (
    <div class="blocking-section">
      <div class="blocking-header">
        <span class="label">
          {enabled ? 'Blocking Active' : 'Blocking Disabled'}
        </span>
        <button
          class={`toggle ${enabled ? 'active' : 'disabled-state'}`}
          onClick={handleToggle}
          disabled={isLoading}
          aria-label={enabled ? 'Disable blocking' : 'Enable blocking'}
        />
      </div>

      {!enabled && timer && timer > 0 && (
        <div class="timer-info">{formatTimer(timer)}</div>
      )}

      {showTimers && (
        <div class="timer-section">
          <div class="label">Disable for:</div>
          <div class="timer-buttons">
            {DISABLE_TIMERS.map(({ label, value }) => (
              <button
                key={value}
                class="timer-btn"
                onClick={() => handleDisableWithTimer(value)}
                disabled={isLoading}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
