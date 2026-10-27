import { useEffect, useRef, useState } from 'react';
import { INCOME_BANDS, incomeLevelAt } from '../engine/income';

const SHEET = { href: '/game/income-track-slot.png', w: 1103, h: 107 };

/** Crops of the slot sheet: 4, 3, 2, the wider 0, and a single space. */
const ART = {
  four: { x: 18, w: 315 },
  three: { x: 375, w: 243 },
  two: { x: 664, w: 155 },
  zero: { x: 858, w: 126 },
  one: { x: 1005, w: 78 },
} as const;

type Art = { x: number; w: number };

/** Widths measured on the BGA track. Hole centers are the black circles in the stretched bracket art. */
const GROUP_WIDTH = { one: 44, zero: 61, two: 84, three: 117, four: 151 } as const;
const HOLE_CENTER: Record<number, readonly number[]> = {
  2: [21.1, 63.1],
  3: [22.1, 59.2, 96.3],
  4: [21.1, 58.0, 94.9, 131.3],
};

function groupWidth(level: number, count: number): number {
  if (count === 1) return level === 0 ? GROUP_WIDTH.zero : GROUP_WIDTH.one;
  if (count === 2) return GROUP_WIDTH.two;
  if (count === 3) return GROUP_WIDTH.three;
  return GROUP_WIDTH.four;
}

function slotCenter(level: number, count: number, index: number): number {
  if (count === 1) return groupWidth(level, count) / 2;
  return HOLE_CENTER[count]?.[index] ?? groupWidth(level, count) / 2;
}

function artFor(level: number, count: number): Art | null {
  if (level === 0) return ART.zero;
  if (count === 1) return ART.one;
  if (count === 2) return ART.two;
  if (count === 3) return ART.three;
  if (count === 4) return ART.four;
  return null;
}

function IncomeStrip({ space, color }: { space: number; color: string }) {
  let x = 0;
  const groups = INCOME_BANDS.map((band) => {
    const count = band.to - band.from + 1;
    const width = groupWidth(band.level, count);
    const group = { ...band, count, width, x };
    x += width;
    return group;
  });
  const here = groups.find((group) => space >= group.from && space <= group.to) ?? groups[0]!;
  const marker = here.x + slotCenter(here.level, here.count, space - here.from);

  return (
    <div className="income-strip" style={{ width: x }}>
      {groups.map((group) => {
        const art = artFor(group.level, group.count);
        const sizeX = art ? (SHEET.w / art.w) * group.width : 0;
        const posX = art ? (-art.x / art.w) * group.width : 0;
        return (
          <div key={group.level} className="income-group" style={{ width: group.width }}>
            {art ? (
              <span
                className="income-art"
                style={{
                  backgroundImage: `url(${SHEET.href})`,
                  backgroundSize: `${sizeX}px 44px`,
                  backgroundPosition: `${posX}px 0`,
                }}
              />
            ) : (
              <span className="income-plain">
                {Array.from({ length: group.count }, (_, index) => (
                  <span
                    key={index}
                    className="income-hole"
                    style={{ left: slotCenter(group.level, group.count, index) - 10.5 }}
                  />
                ))}
              </span>
            )}
            <span className="income-level">{group.level}</span>
          </div>
        );
      })}
      <span className="income-marker" style={{ left: marker - 10.5, background: color }} />
    </div>
  );
}

export function IncomeTrack({ space, color }: { space: number; color: string }) {
  const [open, setOpen] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const level = incomeLevelAt(space);

  useEffect(() => {
    const node = open ? fullRef.current : windowRef.current;
    const marker = node?.querySelector('.income-marker');
    if (!node || !(marker instanceof HTMLElement)) return;
    const left = marker.offsetLeft + marker.offsetWidth / 2 - node.clientWidth / 2;
    node.scrollLeft = Math.max(0, left);
  }, [open, space]);

  return (
    <>
      <button type="button" className="income-window" onClick={() => setOpen(true)} aria-label={`收入 ${level}`}>
        <span className="income-now" style={{ color }}>
          {level}
        </span>
        <div className="income-clip" ref={windowRef}>
          <IncomeStrip space={space} color={color} />
        </div>
      </button>
      {open ? (
        <div className="income-screen" onClick={() => setOpen(false)}>
          <div className="income-screen-panel" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>收入 {level}</strong>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </header>
            <div className="income-clip income-clip-full" ref={fullRef}>
              <IncomeStrip space={space} color={color} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
