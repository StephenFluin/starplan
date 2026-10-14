import { DOCUMENT, PLATFORM_ID, Service, inject, isDevMode } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Google Analytics 4 measurement ID ("G-…"). Analytics stays off while this is empty. */
export const GA_MEASUREMENT_ID = 'G-2J1F7ZRRFH';

type Gtag = (...args: unknown[]) => void;

interface AnalyticsWindow {
  dataLayer?: unknown[];
  gtag?: Gtag;
}

/** What people do with plans, reported to Google Analytics as events. */
export type AnalyticsEvent =
  | { name: 'new_plan'; params: { farm: string; source: 'new_button' | 'farm_picker' } }
  | { name: 'share'; params: { method: 'link'; content_type: 'plan'; farm: string } }
  | { name: 'export_plan'; params: { format: 'json' | 'png'; farm: string } }
  | { name: 'import_plan'; params: { format: 'starplan' | 'v2' | 'save'; farm: string } }
  | { name: 'open_shared_plan'; params: { farm: string } };

/**
 * Loads Google Analytics (gtag.js) in production browsers. It stays off during development, on the
 * server, without a measurement ID, and for visitors who ask not to be tracked; events are then
 * dropped.
 */
@Service()
export class Analytics {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  start(): void {
    if (this.browser && !isDevMode()) loadGtag(this.document, GA_MEASUREMENT_ID);
  }

  event(event: AnalyticsEvent): void {
    const gtag = (this.document.defaultView as (Window & AnalyticsWindow) | null)?.gtag;
    gtag?.('event', event.name, event.params);
  }
}

/**
 * The standard gtag.js snippet: defines `gtag()` to queue commands on `dataLayer`, configures the
 * measurement ID (which sends the page view) and loads gtag.js to send the queue. Returns whether it
 * loaded: not without an ID, nor when the visitor sends Global Privacy Control or Do Not Track.
 */
export function loadGtag(document: Document, measurementId: string): boolean {
  const window = document.defaultView as (Window & AnalyticsWindow) | null;
  if (!measurementId || !window || optedOut(window.navigator)) return false;

  window.dataLayer ??= [];
  const dataLayer = window.dataLayer;
  window.gtag = function gtag() {
    // gtag.js expects each command as an arguments object, not an array.
    dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  return true;
}

function optedOut(navigator: Navigator): boolean {
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  return privacy.globalPrivacyControl === true || navigator.doNotTrack === '1';
}
