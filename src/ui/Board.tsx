import { mapData } from '../engine/catalog';
import type { Cube, LinkState, MarketState, MerchantState, OilfieldState, PlayerId, RailDef, SlotState } from '../engine/types';
import { MARKET_CELLS, MERCHANT_SPOTS, PIPELINE_SPOTS, RAIL_SPOTS, unrotatedPlate, type LinkSpot } from './boardSpots';
import { ATLAS, CITY_SLOTS, ICONS, OILFIELDS, industrySlotId } from './industryAtlas';
import { FLIPPED_ART, TILE_ART, TILE_SHEET } from './matArt';
import {
  CUBE_SPRITE,
  MEEPLE_SHEET,
  MERCHANT_SPRITE,
  OIL_HEX,
  OIL_HEX_FOR_TILE,
  PIPE_SPRITE,
  TRAIN_SPRITE,
  type SpriteBox,
} from './meepleArt';

type BannerColor = 'blue' | 'brown' | 'green' | 'purple' | 'red' | 'silver' | 'white';

const SLOT = 80;

/** icons.png crops of the one-time rewards BGA draws inside an empty link holder. */
const ICON_SHEET = { href: '/game/icons.png', w: 959, h: 951 };
const ROAD_ICON = {
  light: { x: 782, y: 622, w: 129, h: 154 },
  income: { x: 657, y: 625, w: 113, h: 164 },
  whiskey: { x: 401, y: 629, w: 92, h: 170 },
  oil: { x: 260, y: 636, w: 112, h: 148 },
} as const;

function roadBonus(lineId: string): { icon: keyof typeof ROAD_ICON; count: number; label: string } | null {
  if (lineId.startsWith('p-')) {
    const line = mapData.pipelineLines.find((entry) => entry.id === lineId);
    if (!line?.oil) return null;
    return { icon: 'oil', count: line.oil, label: '' };
  }
  const line = mapData.railLines.find((entry) => entry.id === lineId);
  const bonus: RailDef['bonus'] = line?.bonus;
  if (!bonus) return null;
  if (bonus.freeDevelop || bonus.lightTrains) return { icon: 'light', count: 1, label: '' };
  if (bonus.whiskey) return { icon: 'whiskey', count: 1, label: '' };
  if (bonus.incomeSpaces) return { icon: 'income', count: 1, label: String(bonus.incomeSpaces) };
  return null;
}

/** Centers measured on BGA #brass-board-holder, scaled to the 2048 board. */
const BANNERS: { name: string; color: BannerColor; x: number; y: number }[] = [
  { name: 'SAGINAW', color: 'purple', x: 498, y: 422 },
  { name: 'DETROIT', color: 'purple', x: 740, y: 580 },
  { name: 'CHICAGO', color: 'purple', x: 307, y: 862 },
  { name: 'TOLEDO', color: 'green', x: 598, y: 867 },
  { name: 'CLEVELAND', color: 'blue', x: 885, y: 884 },
  { name: 'ERIE', color: 'blue', x: 1104, y: 699 },
  { name: 'BUFFALO', color: 'brown', x: 1227, y: 499 },
  { name: 'ROCHESTER', color: 'brown', x: 1511, y: 477 },
  { name: 'ALBANY', color: 'silver', x: 1686, y: 484 },
  { name: 'WILKES-BARRE', color: 'brown', x: 1461, y: 811 },
  { name: 'HARRISBURG', color: 'red', x: 1246, y: 1131 },
  { name: 'BETHLEHEM', color: 'brown', x: 1438, y: 1089 },
  { name: 'BOSTON', color: 'red', x: 1834, y: 774 },
  { name: 'NEW YORK', color: 'red', x: 1698, y: 1142 },
  { name: 'INDIANAPOLIS', color: 'green', x: 428, y: 1266 },
  { name: 'COLUMBUS', color: 'green', x: 677, y: 1200 },
  { name: 'CINCINNATI', color: 'silver', x: 572, y: 1394 },
  { name: 'PITTSBURGH', color: 'blue', x: 1004, y: 1184 },
  { name: 'CLARKSBURG', color: 'blue', x: 961, y: 1503 },
  { name: 'PHILADELPHIA', color: 'red', x: 1473, y: 1355 },
  { name: 'BALTIMORE', color: 'red', x: 1223, y: 1509 },
  { name: 'EADS BRIDGE', color: 'silver', x: 219, y: 1184 },
  { name: 'CANADA', color: 'silver', x: 935, y: 353 },
  { name: 'THE SOUTH', color: 'silver', x: 1029, y: 1623 },
];

/** Industry-slot centers in the same 2048 space, in CITY_SLOTS order. */
const SLOT_CENTERS: Record<string, { x: number; y: number }[]> = {
  SAGINAW: [
    { x: 497, y: 268 },
    { x: 451, y: 357 },
    { x: 541, y: 357 },
  ],
  DETROIT: [
    { x: 740, y: 426 },
    { x: 692, y: 516 },
    { x: 783, y: 515 },
  ],
  CHICAGO: [
    { x: 262, y: 708 },
    { x: 351, y: 708 },
    { x: 262, y: 797 },
    { x: 351, y: 797 },
  ],
  TOLEDO: [
    { x: 552, y: 714 },
    { x: 552, y: 803 },
    { x: 642, y: 803 },
  ],
  INDIANAPOLIS: [
    { x: 431, y: 1113 },
    { x: 431, y: 1203 },
  ],
  COLUMBUS: [
    { x: 633, y: 1136 },
    { x: 722, y: 1136 },
  ],
  CLARKSBURG: [
    { x: 1005, y: 1349 },
    { x: 917, y: 1439 },
    { x: 1005, y: 1439 },
  ],
  PITTSBURGH: [
    { x: 954, y: 1028 },
    { x: 1043, y: 1028 },
    { x: 912, y: 1117 },
    { x: 1000, y: 1117 },
    { x: 1089, y: 1117 },
  ],
  CLEVELAND: [
    { x: 888, y: 730 },
    { x: 841, y: 819 },
    { x: 932, y: 819 },
  ],
  ERIE: [
    { x: 1051, y: 631 },
    { x: 1143, y: 631 },
  ],
  BUFFALO: [
    { x: 1224, y: 345 },
    { x: 1178, y: 433 },
    { x: 1266, y: 433 },
  ],
  ROCHESTER: [
    { x: 1510, y: 318 },
    { x: 1510, y: 410 },
  ],
  'WILKES-BARRE': [
    { x: 1422, y: 653 },
    { x: 1422, y: 744 },
    { x: 1512, y: 744 },
  ],
  BETHLEHEM: [
    { x: 1440, y: 932 },
    { x: 1440, y: 1024 },
  ],
  HARRISBURG: [
    { x: 1246, y: 975 },
    { x: 1246, y: 1064 },
  ],
  BALTIMORE: [
    { x: 1225, y: 1352 },
    { x: 1179, y: 1443 },
    { x: 1265, y: 1443 },
  ],
  PHILADELPHIA: [
    { x: 1469, y: 1197 },
    { x: 1427, y: 1288 },
    { x: 1516, y: 1288 },
  ],
  'NEW YORK': [
    { x: 1653, y: 989 },
    { x: 1743, y: 989 },
    { x: 1653, y: 1076 },
    { x: 1742, y: 1076 },
  ],
  BOSTON: [
    { x: 1830, y: 616 },
    { x: 1830, y: 705 },
  ],
};

function bannerWidth(name: string): number {
  return Math.round(86 + name.length * 13);
}

/**
 * Selling price, drawn on the blank gold/silver coin at the top of each market.
 * Centers are the coin on board-markets.png. Prices match map.json.
 * The hex "4" badges inside steel/coke markets are slot VP, not this price.
 */
const MARKET_PRICES: { id: string; price: number; x: number; y: number }[] = [
  { id: 'm-wilkes', price: 2, x: 1522, y: 559 },
  { id: 'm-clarksburg', price: 3, x: 916, y: 1251 },
  { id: 'm-toledo', price: 4, x: 647, y: 612 },
  { id: 'm-philadelphia', price: 4, x: 1472, y: 1414 },
  { id: 'm-eads', price: 5, x: 217, y: 1034 },
  { id: 'm-canada', price: 6, x: 935, y: 191 },
];

const CUBE_SIZE = 29;

function oilStock(field: OilfieldState): number {
  if (field.oilCitySlot) return (field.oilCitySlot.cubes.oil ?? 0) + field.oil;
  return field.oil;
}

function OilStock({ x, y, count }: { x: number; y: number; count: number }) {
  if (count <= 0) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="#f4efe4"
      fontSize={40}
      fontWeight={700}
      fontFamily="Georgia, 'Times New Roman', serif"
      stroke="#1c140c"
      strokeWidth={6}
      paintOrder="stroke"
      pointerEvents="none"
    >
      {count}
    </text>
  );
}

/** 重车储备的油桶 token（内联绘制，不依赖 sprite 裁剪）。 */
function OilBarrel({ x, y }: { x: number; y: number }) {
  return (
    <svg x={x} y={y} width={15} height={15} viewBox="0 0 15 15" pointerEvents="none">
      <rect x={1.5} y={2.5} width={12} height={10} rx={3} ry={3} fill="#3a2a18" stroke="#1c140c" strokeWidth={1} />
      <line x1={1.5} y1={6.5} x2={13.5} y2={6.5} stroke="#e8d9a8" strokeWidth={1} />
      <line x1={1.5} y1={8.5} x2={13.5} y2={8.5} stroke="#1c140c" strokeWidth={0.8} />
    </svg>
  );
}

export function Board({
  markets = [],
  merchants = [],
  links = [],
  slots = [],
  players = [],
  selectedLineIds = [],
  legalSlotIds = [],
  selectedSlotId = null,
  sellSlotIds = [],
  sellMerchantIds = [],
  sellChoiceIds = [],
  oilfields = [],
  resourceSlotIds = [],
  selectableOilfieldIds = [],
  selectedOilfieldId = null,
  onLine,
  onMerchant,
  onSlot,
  onOilfield,
  onMarket,
}: {
  markets?: MarketState[];
  merchants?: MerchantState[];
  links?: LinkState[];
  slots?: SlotState[];
  players?: { id: PlayerId; color: string }[];
  selectedLineIds?: string[];
  legalSlotIds?: string[];
  selectedSlotId?: string | null;
  sellSlotIds?: string[];
  onLine?: (lineId: string) => void;
  sellMerchantIds?: string[];
  sellChoiceIds?: string[];
  oilfields?: OilfieldState[];
  resourceSlotIds?: string[];
  selectableOilfieldIds?: string[];
  selectedOilfieldId?: string | null;
  onMerchant?: (locationId: string) => void;
  onSlot?: (slotId: string) => void;
  onOilfield?: (oilfieldId: string) => void;
  onMarket?: (marketId: string, cube: Cube) => void;
}) {
  const linkByLine = new Map(links.map((link) => [link.lineId, link]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const colorByPlayer = new Map(players.map((player) => [player.id, player.color]));
  return (
    <svg className="board" viewBox="0 0 2048 2048" role="img" aria-label="Steel Belt board">
      <image href="/game/board.jpg" x="0" y="0" width="2048" height="2048" />
      <image href="/game/board-rails.png" x="0" y="0" width="2048" height="2048" />
      <image href="/game/board-pipelines.png" x="0" y="0" width="2048" height="2048" />
      <image href="/game/board-markets.png" x="0" y="0" width="2048" height="2048" />
      {MARKET_PRICES.map((market) => (
        <text
          key={market.id}
          x={market.x}
          y={market.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#1a120c"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize={16}
          fontWeight={700}
          pointerEvents="none"
        >
          {market.price}
        </text>
      ))}
      {BANNERS.map((banner) => {
        const icons = CITY_SLOTS[banner.name];
        const centers = SLOT_CENTERS[banner.name];
        if (!icons || !centers) return null;
        return centers.map((center, index) => {
          const icon = ICONS[icons[index]];
          const x = center.x - SLOT / 2;
          const y = center.y - SLOT / 2;
          const slotId = industrySlotId(banner.name, index);
          const built = slotById.get(slotId);
          const art = built?.tileDefId
            ? built.flipped
              ? FLIPPED_ART[built.tileDefId] ?? TILE_ART[built.tileDefId]
              : TILE_ART[built.tileDefId]
            : undefined;
          const ownerColor = built?.owner != null ? colorByPlayer.get(built.owner) : undefined;
          return (
            <g key={`${banner.name}-${index}`} pointerEvents="none">
              <rect
                x={x}
                y={y}
                width={SLOT}
                height={SLOT}
                fill={ownerColor ?? '#121212'}
                stroke="#2a241c"
                strokeWidth={2}
              />
              {built?.flipped ? <rect x={x} y={y} width={SLOT} height={SLOT / 2} fill="#161616" /> : null}
              {art ? (
                <svg x={x} y={y} width={SLOT} height={SLOT} viewBox={`${art[0]} ${art[1]} ${art[2]} ${art[3]}`}>
                  <image href={TILE_SHEET.src} width={TILE_SHEET.w} height={TILE_SHEET.h} />
                </svg>
              ) : (
                <svg
                  x={x}
                  y={y}
                  width={SLOT}
                  height={SLOT}
                  viewBox={`${icon.col * ATLAS.cell} ${icon.row * ATLAS.cell} ${ATLAS.cell} ${ATLAS.cell}`}
                >
                  <image href={ATLAS.href} width={ATLAS.width} height={ATLAS.height} />
                </svg>
              )}
              {built && !built.flipped ? <IndustryCubes slot={built} x={x} y={y} /> : null}
            </g>
          );
        });
      })}
      {OILFIELDS.map((field) => {
        const placed = oilfields.find((entry) => entry.id === field.id);
        const box = placed?.revealed && placed.tileId ? OIL_HEX_FOR_TILE[placed.tileId] ?? OIL_HEX.back : OIL_HEX.back;
        const w = 78;
        const h = w * (box.h / box.w);
        const stock = placed?.revealed ? oilStock(placed) : null;
        const selectable = selectableOilfieldIds.includes(field.id);
        return (
          <g
            key={field.id}
            pointerEvents={selectable ? 'auto' : 'none'}
            role={selectable ? 'button' : undefined}
            aria-label={field.name}
            style={selectable ? { cursor: 'pointer' } : undefined}
            onClick={() => onOilfield?.(field.id)}
          >
            {selectedOilfieldId === field.id || selectable ? (
              <rect
                x={field.x - w / 2}
                y={field.y - h / 2}
                width={w}
                height={h}
                fill="none"
                stroke={selectedOilfieldId === field.id ? '#e6c15a' : '#d7a441'}
                strokeWidth={selectedOilfieldId === field.id ? 5 : 3}
              />
            ) : null}
            <svg x={field.x - w / 2} y={field.y - h / 2} width={w} height={h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
              <image href={MEEPLE_SHEET.href} width={MEEPLE_SHEET.w} height={MEEPLE_SHEET.h} />
            </svg>
            {stock !== null ? <OilStock x={field.x} y={field.y + h / 2 + 18} count={stock} /> : null}
          </g>
        );
      })}
      {BANNERS.map((banner) => {
        const w = bannerWidth(banner.name);
        const h = (w * 238) / 893;
        const dark = banner.color === 'silver' || banner.color === 'white';
        return (
          <g key={banner.name} pointerEvents="none">
            <image
              href={`/game/banner-${banner.color}.png`}
              x={banner.x - w / 2}
              y={banner.y - h / 2}
              width={w}
              height={h}
            />
            <text
              x={banner.x}
              y={banner.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={dark ? '#2c2418' : '#f4efe4'}
              fontFamily="Georgia, 'Times New Roman', serif"
              fontSize={(w * 0.52) / (banner.name.length * 0.55)}
              letterSpacing="0.04em"
            >
              {banner.name}
            </text>
          </g>
        );
      })}
      {marketCubes(markets).map((cube) => (
        <g
          key={`${cube.marketId}-${cube.kind}-${cube.index}`}
          role="button"
          aria-label={`${cube.marketId} ${cube.kind}`}
          style={{ cursor: 'pointer' }}
          onClick={() => onMarket?.(cube.marketId, cube.kind)}
        >
          <rect
            x={cube.x - CUBE_SIZE / 2}
            y={cube.y - CUBE_SIZE / 2}
            width={CUBE_SIZE}
            height={CUBE_SIZE}
            fill="transparent"
          />
          <Meeple
            box={CUBE_SPRITE[cube.kind]}
            x={cube.x - CUBE_SIZE / 2}
            y={cube.y - CUBE_SIZE / 2}
            w={CUBE_SIZE}
            h={CUBE_SIZE}
          />
        </g>
      ))}
      {PIPELINE_SPOTS.map((pipe) => {
        const link = linkByLine.get(pipe.lineId);
        return (
          <LinkToken
            key={pipe.lineId}
            spot={pipe}
            sprite={link ? linkSprite(link) : null}
            bonus={link ? null : roadBonus(pipe.lineId)}
            ownerColor={link ? colorByPlayer.get(link.owner) : undefined}
            selected={selectedLineIds.includes(pipe.lineId)}
            onClick={() => onLine?.(pipe.lineId)}
            link={link}
          />
        );
      })}
      {RAIL_SPOTS.map((rail) => {
        const link = linkByLine.get(rail.lineId);
        return (
          <LinkToken
            key={rail.lineId}
            spot={rail}
            sprite={link ? linkSprite(link) : null}
            bonus={link ? null : roadBonus(rail.lineId)}
            ownerColor={link ? colorByPlayer.get(link.owner) : undefined}
            selected={selectedLineIds.includes(rail.lineId)}
            onClick={() => onLine?.(rail.lineId)}
            link={link}
          />
        );
      })}
      {BANNERS.map((banner) => {
        const centers = SLOT_CENTERS[banner.name];
        if (!centers || !CITY_SLOTS[banner.name]) return null;
        return centers.map((center, index) => {
          const slotId = industrySlotId(banner.name, index);
          const legal = legalSlotIds.includes(slotId);
          const selected = selectedSlotId === slotId;
          const x = center.x - SLOT / 2;
          const y = center.y - SLOT / 2;
          return (
            <rect
              key={`hit-${slotId}`}
              x={x}
              y={y}
              width={SLOT}
              height={SLOT}
              rx={5}
              fill="transparent"
              stroke={
                selected
                  ? '#e6c15a'
                  : legal || resourceSlotIds.includes(slotId) || sellSlotIds.includes(slotId)
                    ? '#d7a441'
                    : 'transparent'
              }
              strokeWidth={selected ? 4 : 3}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={`${banner.name} ${index + 1}`}
              onClick={() => onSlot?.(slotId)}
            />
          );
        });
      })}
      {merchants.map((merchant) => {
        const spot = MERCHANT_SPOTS[merchant.locationId];
        const face = MERCHANT_SPRITE[merchant.art ?? 0];
        if (!spot || !face) return null;
        const merchantName =
          mapData.locations.find((entry) => entry.id === merchant.locationId)?.name ?? merchant.locationId;
        return (
          <g
            key={merchant.locationId}
            role="button"
            aria-label={
              merchant.faceUp
                ? `卖给 ${merchantName}`
                : `${merchantName} 商人已翻面`
            }
            style={{ cursor: 'pointer' }}
            onClick={() => onMerchant?.(merchant.locationId)}
          >
            <rect
              x={spot.x - spot.w / 2}
              y={spot.y - spot.h / 2}
              width={spot.w}
              height={spot.h}
              fill="transparent"
              stroke={
                sellMerchantIds.includes(merchant.locationId)
                  ? '#e6c15a'
                  : sellChoiceIds.includes(merchant.locationId)
                    ? '#d7a441'
                    : 'transparent'
              }
              strokeWidth={4}
            />
            <Meeple
              box={merchant.faceUp ? face.gold : face.red}
              x={spot.x - spot.w / 2}
              y={spot.y - spot.h / 2}
              w={spot.w}
              h={spot.h}
            />
          </g>
        );
      })}
    </svg>
  );
}

function IndustryCubes({ slot, x, y }: { slot: SlotState; x: number; y: number }) {
  const kinds: Cube[] = ['coal', 'iron', 'coke', 'steel'];
  const cubes: Cube[] = [];
  for (const kind of kinds) {
    for (let n = 0; n < (slot.cubes[kind] ?? 0); n += 1) cubes.push(kind);
  }
  if (cubes.length === 0) return null;
  const size = 18;
  const gap = 2;
  const width = cubes.length * size + (cubes.length - 1) * gap;
  const left = x + (SLOT - width) / 2;
  const top = y + SLOT - size - 6;
  return (
    <>
      {cubes.map((kind, index) => (
        <Meeple
          key={`${slot.id}-${kind}-${index}`}
          box={CUBE_SPRITE[kind]}
          x={left + index * (size + gap)}
          y={top}
          w={size}
          h={size}
        />
      ))}
    </>
  );
}

function LinkToken({
  spot,
  sprite,
  bonus,
  ownerColor,
  selected,
  onClick,
  link,
}: {
  spot: LinkSpot;
  sprite: SpriteBox | null;
  bonus: { icon: keyof typeof ROAD_ICON; count: number; label: string } | null;
  ownerColor?: string;
  selected: boolean;
  onClick: () => void;
  link?: LinkState;
}) {
  const plate = unrotatedPlate(spot.w, spot.h, spot.deg);
  const plateW = plate.w;
  const plateH = plate.h;
  const tw = plateW * 0.9;
  const th = sprite ? tw * (sprite.h / sprite.w) : 0;
  return (
    <g
      style={{ cursor: 'pointer' }}
      transform={`rotate(${spot.deg} ${spot.x} ${spot.y})`}
      onClick={onClick}
    >
      <rect
        x={spot.x - plateW / 2}
        y={spot.y - plateH / 2}
        width={plateW}
        height={plateH}
        rx={10}
        ry={10}
        fill={ownerColor ?? 'transparent'}
        stroke={selected ? '#e6c15a' : 'transparent'}
        strokeWidth={3}
        aria-label={spot.lineId}
      />
      {sprite ? <Meeple box={sprite} x={spot.x - tw / 2} y={spot.y - th / 2} w={tw} h={th} /> : null}
      {!sprite && bonus ? <RoadBonus spot={spot} bonus={bonus} /> : null}
      {link && link.kind === 'heavyTrain' ? (
        <g pointerEvents="none">
          {(['coke', 'steel', 'oil'] as const).map((kind, ki) =>
            Array.from({ length: link.cubes[kind] ?? 0 }, (_, i) => (
              <g key={`${link.id}-${kind}-${i}`}>
                {kind === 'oil' ? (
                  <OilBarrel x={spot.x + plateW * 0.5 - 8 + (ki * 18 + i) * 16} y={spot.y + plateH * 0.5 - 26} />
                ) : (
                  <Meeple
                    box={CUBE_SPRITE[kind]}
                    x={spot.x + plateW * 0.5 - 8 + (ki * 18 + i) * 16}
                    y={spot.y + plateH * 0.5 - 26}
                    w={15}
                    h={15}
                  />
                )}
              </g>
            )),
          )}
        </g>
      ) : null}
    </g>
  );
}

function RoadBonus({
  spot,
  bonus,
}: {
  spot: LinkSpot;
  bonus: { icon: keyof typeof ROAD_ICON; count: number; label: string };
}) {
  const box = ROAD_ICON[bonus.icon];
  const h = 30;
  const w = h * (box.w / box.h);
  const gap = 2;
  const total = bonus.count * w + (bonus.count - 1) * gap;
  const left = spot.x - total / 2;
  return (
    <g pointerEvents="none">
      {Array.from({ length: bonus.count }, (_, index) => (
        <svg
          key={index}
          x={left + index * (w + gap)}
          y={spot.y - h / 2}
          width={w}
          height={h}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        >
          <image href={ICON_SHEET.href} width={ICON_SHEET.w} height={ICON_SHEET.h} />
          {bonus.icon === 'income' && bonus.label ? (
            <text
              x={box.x + box.w / 2}
              y={box.y + box.h * 0.42}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#1c140c"
              fontSize={box.h * 0.32}
              fontFamily="Georgia, 'Times New Roman', serif"
              fontWeight={700}
            >
              {bonus.label}
            </text>
          ) : null}
        </svg>
      ))}
    </g>
  );
}

function Meeple({ box, x, y, w, h }: { box: SpriteBox; x: number; y: number; w: number; h: number }) {
  if (!box) return null;
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} pointerEvents="none">
      <image href={MEEPLE_SHEET.href} width={MEEPLE_SHEET.w} height={MEEPLE_SHEET.h} />
    </svg>
  );
}

function marketCubes(markets: MarketState[]): { marketId: string; kind: Cube; index: number; x: number; y: number }[] {
  const drawn: { marketId: string; kind: Cube; index: number; x: number; y: number }[] = [];
  for (const market of markets) {
    const def = mapData.markets.find((item) => item.id === market.id);
    const cells = MARKET_CELLS[market.id];
    if (!def || !cells) continue;
    const per = market.slots.length / def.cubes.length;
    def.cubes.forEach((kind, column) => {
      const spots = cells[kind];
      if (!spots) return;
      for (let index = 0; index < per; index += 1) {
        const slot = market.slots[column * per + index];
        const spot = spots[index];
        if (slot?.cube && spot) drawn.push({ marketId: market.id, kind, index, x: spot.x, y: spot.y });
      }
    });
  }
  return drawn;
}

function linkSprite(link: LinkState): SpriteBox | null {
  if (link.kind === 'lightTrain') return TRAIN_SPRITE.light;
  if (link.kind === 'heavyTrain') {
    if (link.heavyType === 'steelResource') return TRAIN_SPRITE.steel;
    if (link.heavyType === 'whiskey') return TRAIN_SPRITE.whiskey;
    if (link.heavyType === 'oilResource') return TRAIN_SPRITE.oil;
    if (link.heavyType === 'cokeResource') return TRAIN_SPRITE.coke;
    if (link.heavyType === 'doubleLink') return TRAIN_SPRITE.score;
    if (link.heavyType === 'replacement') return TRAIN_SPRITE.swap;
  }
  if (link.kind === 'pipeline') {
    if (link.pipelineType === 'reserve') return PIPE_SPRITE.broken;
    if (link.pipelineType === 'income') return PIPE_SPRITE.income2;
    if (link.pipelineType === 'money') return PIPE_SPRITE.money10;
    if (link.pipelineType === 'vp') {
      if (link.pipelinePoints === 7) return PIPE_SPRITE.points7;
      if (link.pipelinePoints === 4) return PIPE_SPRITE.points4;
      return PIPE_SPRITE.points3;
    }
  }
  return null;
}
