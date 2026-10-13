import { PlanDocument } from './plan-document';
import { SavedPlan, decodePlan, encodePlan, fromSaved, fromV2, parsePlanJson, toSaved } from './serialize';

describe('serialize', () => {
  const plan: SavedPlan = {
    v: 3,
    layout: 'regular',
    tiles: { road: [1, 2, 3, 4], parsnip: [10, 10] },
    objects: [['keg', 5, 5], ['house', 59, 12]],
  };

  it('round-trips a plan through a document', () => {
    const doc = new PlanDocument(80, 65);
    doc.apply(fromSaved(plan, doc));
    expect(doc.tileAt(3, 4)).toBe('road');
    expect(doc.objectAt(60, 13)?.itemId).toBe('house');
    expect(toSaved('regular', doc)).toEqual(plan);
  });

  it('moves v1 objects from their sprite corner down onto their footprint', () => {
    const doc = new PlanDocument(80, 65);
    doc.apply(fromSaved({ v: 1, layout: 'regular', tiles: {}, objects: [['house', 59, 8], ['greenhouse', 25, 6], ['keg', 5, 5]] }, doc));
    expect(toSaved('regular', doc).objects).toEqual([['keg', 5, 5], ['greenhouse', 25, 10], ['house', 59, 12]]);
  });

  it("moves v2 farmhouses down a row onto the game's 9x5 footprint", () => {
    const doc = new PlanDocument(80, 65);
    doc.apply(fromSaved({ v: 2, layout: 'regular', tiles: {}, objects: [['house-upgrade-2', 59, 11], ['greenhouse', 25, 10]] }, doc));
    expect(toSaved('regular', doc).objects).toEqual([['greenhouse', 25, 10], ['house-upgrade-2', 59, 12]]);
  });

  it('round-trips through a compressed share string', async () => {
    const encoded = await encodePlan(plan);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePlan(encoded)).toEqual(plan);
  });

  it('returns null for corrupt share strings', async () => {
    expect(await decodePlan('not-a-plan')).toBeNull();
  });

  it('imports v2 plans, converting pixels to tiles and legacy ids', () => {
    const v2 = {
      tiles: [
        { type: 'wood-fence', x: '32', y: '48' },
        { type: 'hoedirt', x: 16, y: 16 },
      ],
      buildings: [
        { type: 'mayo', x: 160, y: 160 },
        { type: 'not-a-real-item', x: 0, y: 0 },
      ],
      options: { layout: 'combat' },
    };
    expect(fromV2(v2)).toEqual({
      v: 1,
      layout: 'combat',
      tiles: { fence: [2, 3], farmland: [1, 1] },
      objects: [['mayonnaise-machine', 10, 10]],
    });
    expect(parsePlanJson(JSON.stringify(v2))?.legacy).toBe(true);
    expect(parsePlanJson(JSON.stringify(plan))?.legacy).toBe(false);
    expect(parsePlanJson('{"hello":1}')).toBeNull();
  });
});
