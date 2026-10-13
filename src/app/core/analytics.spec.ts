import { loadGtag } from './analytics';

describe('loadGtag', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('test');
    // A document made this way has no window; borrow the test window, minus earlier gtag state.
    const win = window as Window & { dataLayer?: unknown[]; gtag?: unknown };
    delete win.dataLayer;
    delete win.gtag;
    Object.defineProperty(doc, 'defaultView', { value: win });
  });

  const scripts = () => [...doc.head.querySelectorAll('script')].map((s) => s.src);

  it('queues the page view config and loads gtag.js for the measurement ID', () => {
    expect(loadGtag(doc, 'G-TEST123')).toBe(true);
    expect(scripts()).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-TEST123']);
    const queued = (window as Window & { dataLayer?: IArguments[] }).dataLayer!.map((args) => [...args]);
    expect(queued[0][0]).toBe('js');
    expect(queued[1]).toEqual(['config', 'G-TEST123']);
  });

  it('stays off without a measurement ID', () => {
    expect(loadGtag(doc, '')).toBe(false);
    expect(scripts()).toEqual([]);
  });

  it('respects Global Privacy Control and Do Not Track', () => {
    for (const [name, value] of [['globalPrivacyControl', true], ['doNotTrack', '1']] as const) {
      Object.defineProperty(navigator, name, { value, configurable: true });
      try {
        expect(loadGtag(doc, 'G-TEST123'), name).toBe(false);
      } finally {
        delete (navigator as unknown as Record<string, unknown>)[name];
      }
    }
    expect(scripts()).toEqual([]);
  });
});
