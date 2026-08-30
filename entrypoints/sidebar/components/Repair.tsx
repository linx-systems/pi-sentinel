import { useState } from "preact/hooks";
import browser from "webextension-polyfill";
import type { QueryEntry } from "~/utils/types";
import type {
  CreateTemporaryAllowsResult,
  MessageResponse,
  RemoveTemporaryAllowsResult,
  SerializableTabDomains,
} from "~/utils/messaging";
import { isQueryBlocked, isSameSite } from "~/utils/utils";
import { logger } from "~/utils/logger";
import { useToast } from "./ToastContext";

const RECENT_QUERY_LIMIT = 100;
const CAPTURE_WINDOW_SECONDS = 120;

type TemporaryAllowDuration = 300 | 3600 | null;

export interface RepairCandidate {
  domain: string;
  count: number;
  isFirstParty: boolean;
  reasons: string[];
}

interface RepairProps {
  onTemporaryAllowsChanged: () => Promise<void>;
}

function queryKey(query: QueryEntry): string {
  return `${query.instanceId || "single"}-${query.id ?? `${query.timestamp}-${query.domain}`}`;
}

function normalizeTimestamp(query: QueryEntry): number {
  const timestamp =
    query.timestamp ??
    Number((query as QueryEntry & { time?: number }).time ?? 0);
  return Number(timestamp) || 0;
}

/**
 * Produces stable, domain-only recommendations from queries captured for one tab.
 * Blocked queries outside the tab's observed domain set are intentionally excluded.
 */
export function rankRepairCandidates(
  queries: QueryEntry[],
  tabDomains: SerializableTabDomains,
): RepairCandidate[] {
  const observedDomains = new Set(tabDomains.domains);
  const counts = new Map<string, number>();

  for (const query of queries) {
    if (observedDomains.has(query.domain) && isQueryBlocked(query.status)) {
      counts.set(query.domain, (counts.get(query.domain) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([domain, count]) => {
      const isFirstParty =
        domain === tabDomains.firstPartyDomain ||
        isSameSite(domain, tabDomains.firstPartyDomain);
      const reasons = [
        isFirstParty
          ? "Same site as this page"
          : "Third-party request on this page",
        `${count} blocked ${count === 1 ? "query" : "queries"} during capture`,
      ];

      return { domain, count, isFirstParty, reasons };
    })
    .sort(
      (a, b) =>
        Number(b.isFirstParty) - Number(a.isFirstParty) ||
        b.count - a.count ||
        a.domain.localeCompare(b.domain),
    );
}

function durationLabel(durationSeconds: TemporaryAllowDuration): string {
  if (durationSeconds === null) return "Browser session";
  return durationSeconds === 300 ? "5 minutes" : "1 hour";
}

async function waitForTabReload(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("The page did not finish reloading in time."));
    }, 15_000);

    const onUpdated = (
      updatedTabId: number,
      changeInfo: { status?: string },
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        window.clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.reload(tabId).catch((error) => {
      window.clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      reject(error);
    });
  });
}

export function Repair({ onTemporaryAllowsChanged }: RepairProps) {
  const { showToast } = useToast();
  const [candidates, setCandidates] = useState<RepairCandidate[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set(),
  );
  const [durationSeconds, setDurationSeconds] =
    useState<TemporaryAllowDuration>(300);
  const [hasCaptured, setHasCaptured] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAllowing, setIsAllowing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const loadQueries = async (): Promise<QueryEntry[]> => {
    const response = (await browser.runtime.sendMessage({
      type: "GET_QUERIES",
      payload: { length: RECENT_QUERY_LIMIT },
    })) as MessageResponse<QueryEntry[]> | undefined;

    if (!response?.success || !Array.isArray(response.data)) {
      throw new Error(response?.error || "Could not read recent DNS queries.");
    }

    return response.data;
  };

  const capture = async () => {
    setIsCapturing(true);
    setCaptureError(null);
    setActionFeedback(null);
    setHasCaptured(false);
    setCandidates([]);
    setSelectedDomains(new Set());

    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        throw new Error("Could not identify the active tab.");
      }

      const captureStartedAt = Date.now() / 1000;
      const before = await loadQueries();
      const priorQueryKeys = new Set(before.map(queryKey));

      await waitForTabReload(tab.id);

      const [domainResponse, queries] = await Promise.all([
        browser.runtime.sendMessage({
          type: "GET_TAB_DOMAINS",
          payload: { tabId: tab.id },
        }) as Promise<MessageResponse<SerializableTabDomains> | undefined>,
        loadQueries(),
      ]);

      if (!domainResponse?.success || !domainResponse.data) {
        throw new Error(
          domainResponse?.error || "Could not read domains for this page.",
        );
      }

      const windowStart = captureStartedAt - CAPTURE_WINDOW_SECONDS;
      const capturedQueries = queries.filter(
        (query) =>
          !priorQueryKeys.has(queryKey(query)) &&
          normalizeTimestamp(query) >= windowStart,
      );
      const nextCandidates = rankRepairCandidates(
        capturedQueries,
        domainResponse.data,
      );
      setCandidates(nextCandidates);
      setHasCaptured(true);

      if (nextCandidates.length === 0) {
        setActionFeedback(
          "No blocked DNS requests from this page were observed during the capture.",
        );
      }
    } catch (error) {
      logger.error("Repair capture failed:", error);
      setCaptureError(
        error instanceof Error ? error.message : "Could not capture this page.",
      );
    } finally {
      setIsCapturing(false);
    }
  };

  const toggleCandidate = (domain: string) => {
    setSelectedDomains((current) => {
      const next = new Set(current);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const allowSelected = async () => {
    const domains = candidates
      .map((candidate) => candidate.domain)
      .filter((domain) => selectedDomains.has(domain));
    if (domains.length === 0) return;

    setIsAllowing(true);
    setActionFeedback(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "CREATE_TEMPORARY_ALLOWS",
        payload: { domains, durationSeconds },
      })) as MessageResponse<CreateTemporaryAllowsResult> | undefined;
      const result = response?.data;

      if (!response?.success || !result) {
        throw new Error(
          response?.error || "Could not create the temporary allow.",
        );
      }

      const createdIds = result.entries.map((entry) => entry.id);
      setEntryIds((current) => [...new Set([...current, ...createdIds])]);
      setSelectedDomains(new Set());
      await onTemporaryAllowsChanged();

      const failures = result.failures.length;
      const skipped = result.skippedDomains.length;
      const summary = [
        `Allowed ${result.entries.length} ${result.entries.length === 1 ? "entry" : "entries"} for ${durationLabel(durationSeconds)}.`,
      ];
      if (skipped) summary.push(`${skipped} already allowed or unavailable.`);
      if (failures)
        summary.push(`${failures} target${failures === 1 ? "" : "s"} failed.`);
      setActionFeedback(summary.join(" "));
      showToast({
        type: failures ? "error" : "success",
        message: summary.join(" "),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not create the temporary allow.";
      setActionFeedback(message);
      showToast({ type: "error", message });
    } finally {
      setIsAllowing(false);
    }
  };

  const undoAll = async () => {
    if (entryIds.length === 0) return;
    setIsUndoing(true);
    setActionFeedback(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "REMOVE_TEMPORARY_ALLOWS",
        payload: { entryIds },
      })) as MessageResponse<RemoveTemporaryAllowsResult> | undefined;
      const result = response?.data;
      if (!response?.success || !result) {
        throw new Error(
          response?.error || "Could not undo the temporary allows.",
        );
      }

      const remaining = new Set(entryIds);
      result.removedIds.forEach((id) => remaining.delete(id));
      setEntryIds([...remaining]);
      await onTemporaryAllowsChanged();

      const message = result.failures.length
        ? `Removed ${result.removedIds.length} entries; ${result.failures.length} could not be removed.`
        : `Removed ${result.removedIds.length} temporary ${result.removedIds.length === 1 ? "allow" : "allows"}.`;
      setActionFeedback(message);
      showToast({
        type: result.failures.length ? "error" : "success",
        message,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not undo the temporary allows.";
      setActionFeedback(message);
      showToast({ type: "error", message });
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <section class="repair-assistant" aria-labelledby="repair-heading">
      <h2 id="repair-heading">Repair a broken site</h2>
      <p class="repair-description">
        Capture a reload, then choose only the blocked domains you want to allow
        temporarily.
      </p>
      <button
        class="repair-capture-button"
        onClick={capture}
        disabled={isCapturing || isAllowing}
      >
        {isCapturing ? "Capturing reload…" : "Start capture and reload"}
      </button>

      {captureError && (
        <p class="repair-feedback error" role="alert">
          {captureError}
        </p>
      )}
      {actionFeedback && (
        <p class="repair-feedback" role="status">
          {actionFeedback}
        </p>
      )}

      {!isCapturing && !hasCaptured && !captureError && (
        <p class="repair-feedback">
          No capture yet. This does not change your Pi-hole configuration.
        </p>
      )}
      {candidates.length > 0 && (
        <>
          <fieldset class="repair-duration" disabled={isAllowing}>
            <legend>Temporary allow duration</legend>
            {([300, 3600, null] as TemporaryAllowDuration[]).map((duration) => (
              <label key={String(duration)}>
                <input
                  type="radio"
                  name="temporary-allow-duration"
                  checked={durationSeconds === duration}
                  onChange={() => setDurationSeconds(duration)}
                />
                {durationLabel(duration)}
              </label>
            ))}
          </fieldset>

          <div
            class="repair-candidates"
            aria-label="Blocked domains observed during capture"
          >
            {candidates.map((candidate) => (
              <label class="repair-candidate" key={candidate.domain}>
                <input
                  type="checkbox"
                  checked={selectedDomains.has(candidate.domain)}
                  onChange={() => toggleCandidate(candidate.domain)}
                  disabled={isAllowing}
                />
                <span class="repair-candidate-content">
                  <span class="repair-candidate-domain">
                    {candidate.domain}
                  </span>
                  <span class="repair-candidate-reasons">
                    {candidate.reasons.join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <button
            class="repair-allow-button"
            onClick={allowSelected}
            disabled={selectedDomains.size === 0 || isAllowing}
          >
            {isAllowing
              ? "Creating temporary allow…"
              : `Allow selected for ${durationLabel(durationSeconds)}`}
          </button>
        </>
      )}

      {entryIds.length > 0 && (
        <button
          class="repair-undo-button"
          onClick={undoAll}
          disabled={isUndoing}
        >
          {isUndoing ? "Undoing…" : "Undo all created allows"}
        </button>
      )}
    </section>
  );
}
