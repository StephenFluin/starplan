import { LAYOUTS } from '../data/layouts';
import { SaveImport, importSave } from './save-import';

const tile = (x: number, y: number, value: string) =>
  `<item><key><Vector2><X>${x}</X><Y>${y}</Y></Vector2></key><value>${value}</value></item>`;
const object = (name: string, id: string, big: boolean, extra = '') =>
  `<Object><name>${name}</name><itemId>${id}</itemId><bigCraftable>${big}</bigCraftable>${extra}</Object>`;
const feature = (type: string, body: string) =>
  `<TerrainFeature xsi:type="${type}">${body}</TerrainFeature>`;

/** A small save in the 1.6 format, with whatever the farm should hold. */
function save(
  farm: {
    buildings?: string;
    objects?: string;
    terrain?: string;
    clumps?: string;
    fields?: string;
  },
  root = '<whichFarm>0</whichFarm>',
) {
  return `<?xml version="1.0" encoding="utf-8"?>
<SaveGame xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <player><farmName>Test</farmName><houseUpgradeLevel>1</houseUpgradeLevel><mailReceived><string>ccPantry</string></mailReceived></player>
  <locations>
    <GameLocation><name>Town</name></GameLocation>
    <GameLocation xsi:type="Farm">
      <buildings>${farm.buildings ?? ''}</buildings>
      <objects>${farm.objects ?? ''}</objects>
      <resourceClumps>${farm.clumps ?? ''}</resourceClumps>
      <largeTerrainFeatures />
      <terrainFeatures>${farm.terrain ?? ''}</terrainFeatures>
      <name>Farm</name>
      ${farm.fields ?? ''}
    </GameLocation>
  </locations>
  ${root}
</SaveGame>`;
}

function load(xml: string): SaveImport {
  const result = importSave(xml, LAYOUTS);
  if (typeof result === 'string') throw new Error(result);
  return result;
}

const at = (result: SaveImport, x: number, y: number) =>
  result.plan.objects.find(([, ox, oy]) => ox === x && oy === y)?.[0];
const tilesOf = (result: SaveImport, itemId: string) => result.plan.tiles[itemId] ?? [];

describe('importSave', () => {
  it('places buildings where the save has them, with their upgrades and skins', () => {
    const building = (type: string, x: number, y: number, skin = '') =>
      `<Building><buildingType>${type}</buildingType><tileX>${x}</tileX><tileY>${y}</tileY><skinId>${skin}</skinId></Building>`;
    const result = load(
      save({
        buildings: [
          building('Farmhouse', 50, 20),
          building('Greenhouse', 10, 30),
          building('Cabin', 5, 5, 'Log Cabin'),
          building('Deluxe Coop', 30, 40),
          building('Pet Bowl', 70, 20),
        ].join(''),
        fields: '<greenhouseMoved>true</greenhouseMoved>',
      }),
    );
    expect(result.name).toBe('Test Farm');
    expect(result.plan.layout).toBe('regular');
    expect(result.plan.greenhouseMoved).toBe(true);
    expect(at(result, 50, 20)).toBe('house-upgrade-2');
    expect(at(result, 10, 30)).toBe('greenhouse-fixed');
    expect(at(result, 5, 5)).toBe('log-cabin');
    expect(at(result, 30, 40)).toBe('deluxe-coop');
    // The shipping bin wasn't in the save's buildings (as in older saves): it goes to its usual spot.
    expect(at(result, 71, 14)).toBe('shipping-bin');
    expect(result.plan.objects.filter(([id]) => id === 'pet-bowl')).toHaveLength(1);
  });

  it('reads machines, fences and their attachments, and leaves out debris and unknown items', () => {
    const result = load(
      save({
        objects: [
          tile(1, 1, object('Keg', '12', true)),
          tile(
            2,
            1,
            object(
              'Iridium Sprinkler',
              '645',
              false,
              '<heldObject><Object><name>Pressure Nozzle</name></Object></heldObject>',
            ),
          ),
          tile(3, 1, object('Rarecrow', '137', true)),
          tile(4, 1, object('Chest', 'BigChest', true)),
          tile(
            5,
            1,
            `<Object xsi:type="Fence"><name>Hardwood Fence</name><itemId>298</itemId><heldObject><Object><name>Torch</name></Object></heldObject></Object>`,
          ),
          tile(6, 1, object('Weeds', '674', false)),
          tile(7, 1, object('Crab Pot', '710', false)),
        ].join(''),
      }),
    );
    expect(at(result, 1, 1)).toBe('keg');
    expect(at(result, 2, 1)).toBe('irid-pressured-sprinkler');
    expect(at(result, 3, 1)).toBe('rarecrow-5');
    expect(at(result, 4, 1)).toBe('big-chest');
    expect(tilesOf(result, 'torch-hardwood-fence')).toEqual([5, 1]);
    expect(result.skipped.get('Weeds, stones and twigs')).toBe(1);
    expect(result.skipped.get('Crab Pot')).toBe(1);
  });

  it('reads crops, soil, floors, tea bushes, trees and resource clumps', () => {
    const result = load(
      save({
        terrain: [
          tile(
            10,
            10,
            feature(
              'HoeDirt',
              '<crop><indexOfHarvest>24</indexOfHarvest><seedIndex>472</seedIndex></crop>',
            ),
          ),
          tile(11, 10, feature('HoeDirt', '<state>0</state>')),
          tile(
            12,
            10,
            feature(
              'HoeDirt',
              '<crop><indexOfHarvest>16</indexOfHarvest><seedIndex>495</seedIndex></crop>',
            ),
          ),
          tile(13, 10, feature('Flooring', '<whichFloor>8</whichFloor>')),
          tile(14, 10, feature('Bush', '<size>3</size>')),
          tile(30, 30, feature('FruitTree', '<growthStage>4</growthStage><treeId>633</treeId>')),
          tile(40, 30, feature('Tree', '<growthStage>5</growthStage><treeType>1</treeType>')),
          tile(41, 30, feature('Tree', '<growthStage>5</growthStage><treeType>2</treeType>')),
          tile(50, 30, feature('Tree', '<growthStage>1</growthStage><treeType>3</treeType>')),
        ].join(''),
        objects: tile(40, 30, object('Tapper', '105', true)),
        clumps:
          '<ResourceClump><parentSheetIndex>600</parentSheetIndex><tile><X>20</X><Y>20</Y></tile></ResourceClump>',
      }),
    );
    expect(tilesOf(result, 'parsnip')).toEqual([10, 10]);
    expect(tilesOf(result, 'farmland')).toEqual([11, 10]);
    expect(tilesOf(result, 'spring-seeds')).toEqual([12, 10]);
    expect(tilesOf(result, 'road')).toEqual([13, 10]);
    expect(tilesOf(result, 'tea')).toEqual([14, 10]);
    expect(at(result, 20, 20)).toBe('large-stump');
    // Fruit trees are 3x3 with the trunk on the bottom row's middle tile; wild trees stand on their trunk's tile.
    expect(at(result, 29, 28)).toBe('apple');
    expect(at(result, 40, 30)).toBe('oak-tree');
    expect(at(result, 41, 30)).toBe('maple-tree');
    expect(result.skipped.get('Tapper (on a tree)')).toBe(1);
    // Saplings are left out.
    expect(result.plan.objects.some(([id]) => id === 'pine-tree')).toBe(false);
  });

  it('reads the greenhouse and the insides of sheds, barns and coops as plans of their own', () => {
    const shed = `<Building><buildingType>Big Shed</buildingType><tileX>40</tileX><tileY>40</tileY><indoors xsi:type="Shed"><objects>${tile(3, 4, object('Keg', '12', true))}</objects><terrainFeatures /></indoors></Building>`;
    const coop = `<Building><buildingType>Coop</buildingType><tileX>50</tileX><tileY>40</tileY><indoors xsi:type="AnimalHouse"><objects>${tile(6, 3, object('Hay', '178', false))}</objects><terrainFeatures /></indoors></Building>`;
    const xml = save({ buildings: shed + coop }).replace(
      '<GameLocation><name>Town</name></GameLocation>',
      `<GameLocation><name>Greenhouse</name><objects /><terrainFeatures>${tile(5, 8, feature('HoeDirt', '<crop><indexOfHarvest>454</indexOfHarvest></crop>'))}</terrainFeatures></GameLocation>`,
    );
    const result = load(xml);
    expect(result.interiors.map((i) => [i.name, i.plan.layout])).toEqual([
      ['Test Farm: Greenhouse', 'greenhouse'],
      ['Test Farm: Big Shed', 'shed-big'],
    ]);
    expect(result.interiors[0].plan.tiles['ancient-fruit']).toEqual([5, 8]);
    expect(result.interiors[1].plan.objects).toEqual([['keg', 3, 4]]);
  });

  it('knows the farm type, and says when it can’t read a file', () => {
    expect(load(save({}, '<whichFarm>6</whichFarm>')).plan.layout).toBe('beach');
    expect(
      load(
        save({}, '<whichFarm>7</whichFarm><whichModFarm><Id>MeadowlandsFarm</Id></whichModFarm>'),
      ).plan.layout,
    ).toBe('ranching');
    expect(
      importSave(
        save({}, '<whichFarm>7</whichFarm><whichModFarm><Id>SomeMod.Farm</Id></whichModFarm>'),
        LAYOUTS,
      ),
    ).toBe('unknown-farm');
    expect(importSave('<?xml version="1.0"?><Farmer><name>Bopper</name></Farmer>', LAYOUTS)).toBe(
      'save-info',
    );
    expect(importSave('<html></html>', LAYOUTS)).toBe('not-a-save');
  });
});
