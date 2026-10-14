import { blockedMessage } from './block-message';

describe('blockedMessage', () => {
  it('names the item and what is in its way', () => {
    expect(blockedMessage({ itemId: 'coop', reason: { kind: 'object', itemId: 'keg' } })).toBe("Coop doesn't fit there: Keg is in the way.");
    expect(blockedMessage({ itemId: 'parsnip', reason: { kind: 'ground', restriction: 'tillable' } })).toBe(
      'Parsnip needs tillable ground there. The View menu can show where that is.',
    );
    expect(blockedMessage({ itemId: 'coop', reason: { kind: 'door' } })).toBe('Coop needs buildable ground or a path in front of its door.');
  });
});
