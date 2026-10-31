import { useEffect, useState } from 'react';
import { accessibleTileIds } from '../engine/mat';
import type { MatTile, PlayerId } from '../engine/types';
import {
  MAT_COLUMNS,
  MAT_LINK_LOCK,
  MAT_LINKS,
  MAT_SIZE,
  STACK_TILE,
  TILE_SHEET,
  type MatSlot,
  type TileBox,
} from './matArt';
import { PANEL_TOKEN } from './meepleArt';

/** BGA's buildable overview draws every tile at 58×58. */
const BUILD_TILE = { w: 58, h: 58 };

export function PlayerMat({
  name,
  mat,
  selectedTileId,
  selectedTileIds,
  onSelectTile,
  forceOpen = false,
  pickOnMat = false,
  lockedKeys,
  color,
}: {
  playerId: PlayerId;
  name: string;
  mat: MatTile[];
  color: string;
  selectedTileId?: string | null;
  selectedTileIds?: string[];
  onSelectTile?: (tileDefId: string) => void;
  forceOpen?: boolean;
  pickOnMat?: boolean;
  lockedKeys?: string[];
}) {
  const [open, setOpen] = useState(false);
  // 连锁研发：已选的低级 tile 视为已研发（解锁由它覆盖的高一级），使 ck1→ck2 可同一研发动作连选。
  const accessible = accessibleTileIds(mat, selectedTileIds ?? []);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="build-row">
        {MAT_COLUMNS.flatMap((column) => column.stacks)
          .filter((stack) => {
            const tileId = STACK_TILE[stack.id];
            return Boolean(tileId && accessible.has(tileId));
          })
          .map((stack) => {
          const tileId = STACK_TILE[stack.id];
          const picked = tileId ? (selectedTileIds?.filter((id) => id === tileId).length ?? 0) : 0;
          const selected = Boolean(tileId && (picked > 0 || selectedTileId === tileId));
          return (
          <button
            key={stack.id}
            type="button"
            className={selected ? 'build-tile selected' : 'build-tile'}
            aria-label={`${stack.industry} ${stack.level}`}
            aria-pressed={selected}
            onClick={() => (tileId && onSelectTile ? onSelectTile(tileId) : setOpen(true))}
          >
            <TileFace box={stack.box} flipped={bornFlipped(stack.id)} fit={BUILD_TILE} color={color} />
            {picked > 1 ? <em>{picked}</em> : null}
          </button>
          );
        })}
        <button type="button" className="mat-open" onClick={() => setOpen(true)}>
          个人版图
        </button>
      </div>
      {open ? (
        <div className="mat-modal" role="dialog" aria-label={`${name}的个人版图`} onClick={() => setOpen(false)}>
          <div className="mat-sheet" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>{name}</strong>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </header>
            <div className="mat-board">
              <img className="mat-photo" src="/game/player-mat.jpg" alt="" />
              {MAT_COLUMNS.flatMap((column) => column.stacks).map((stack) => {
                const tileId = STACK_TILE[stack.id];
                const left = copiesLeft(mat, tileId);
                if (left === 0) return null;
                const picked = tileId ? (selectedTileIds?.filter((id) => id === tileId).length ?? 0) : 0;
                const canPick = Boolean(pickOnMat && tileId && accessible.has(tileId) && onSelectTile);
                const face = <TileFace box={stack.box} flipped={bornFlipped(stack.id)} color={color} frame={stack.slot} />;
                if (!canPick) {
                  return (
                    <span key={stack.id} className="mat-slot" style={slotStyle(stack.slot)} title={`${stack.industry} ${stack.level}`}>
                      {face}
                      {picked > 0 ? <em className="mat-picked">选{picked}</em> : null}
                      {(left ?? stack.count) > 1 ? <em>×{left ?? stack.count}</em> : null}
                    </span>
                  );
                }
                return (
                  <button
                    key={stack.id}
                    type="button"
                    className={picked > 0 ? 'mat-slot selected' : 'mat-slot'}
                    style={slotStyle(stack.slot)}
                    title={`${stack.industry} ${stack.level}`}
                    onClick={() => tileId && onSelectTile?.(tileId)}
                  >
                    {face}
                    {picked > 0 ? <em className="mat-picked">选{picked}</em> : null}
                    {(left ?? stack.count) > 1 ? <em>×{left ?? stack.count}</em> : null}
                  </button>
                );
              })}
              {MAT_LINKS.map((link) => {
                const lock = MAT_LINK_LOCK[link.id];
                if (!lock || !lockedKeys?.includes(lock)) return null;
                const token = PANEL_TOKEN[link.token];
                if (!token) return null;
                return (
                  <span key={link.id} className="mat-link" style={slotStyle(link.slot)}>
                    <span className="link-plate" style={{ ['--plate-color' as string]: color }} />
                    <i
                      className="token"
                      aria-label={link.id}
                      style={{
                        width: '92%',
                        aspectRatio: `${token.w} / ${token.h}`,
                        backgroundPosition: token.pos,
                        backgroundSize: token.size,
                      }}
                    />
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const BORN_FLIPPED = new Set(['mfg-3', 'alt-4', 'loco-7', 'sky-3', 'sky-5']);

function bornFlipped(stackId: string) {
  return BORN_FLIPPED.has(stackId);
}

function copiesLeft(mat: MatTile[], defId: string | undefined): number | null {
  if (!defId || !mat.some((tile) => tile.defId === defId)) return null;
  return mat.filter((tile) => tile.defId === defId && !tile.removed).length;
}

function slotStyle(slot: MatSlot) {
  return {
    left: `${(slot.x / MAT_SIZE.w) * 100}%`,
    top: `${(slot.y / MAT_SIZE.h) * 100}%`,
    width: `${(slot.w / MAT_SIZE.w) * 100}%`,
    height: `${(slot.h / MAT_SIZE.h) * 100}%`,
  };
}

function TileFace({
  box,
  fit,
  frame,
  color,
  flipped = false,
}: {
  box?: TileBox;
  fit?: { w: number; h: number };
  frame?: { w: number; h: number };
  color: string;
  flipped?: boolean;
}) {
  if (!box) {
    return (
      <span className="flipped-plate" style={{ width: fit ? fit.w : '100%', height: fit ? fit.h : '100%' }}>
        <i />
        <i style={{ background: color }} />
      </span>
    );
  }
  const [x, y, w, h] = box;
  const scale = fit ? Math.min(fit.w / w, fit.h / h) : undefined;
  const aspect = frame ? frame.w / frame.h : 1;
  const plate =
    fit && scale
      ? {
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          marginLeft: Math.round((fit.w - w * scale) / 2),
          marginTop: Math.round((fit.h - h * scale) / 2),
        }
      : null;
  return (
    <span
      className="tile-face"
      style={{
        width: fit ? fit.w : '100%',
        height: fit ? fit.h : '100%',
      }}
    >
      <span
        className="tile-sheet"
        style={{
          display: 'block',
          position: fit ? 'relative' : 'absolute',
          inset: fit ? undefined : 0,
          overflow: 'hidden',
          width: plate ? plate.width : '100%',
          height: plate ? plate.height : '100%',
          marginLeft: plate?.marginLeft,
          marginTop: plate?.marginTop,
          ['--plate-color' as string]: color,
        }}
      >
        <span className={flipped ? 'tile-plate split' : 'tile-plate'}>
          {flipped ? (
            <>
              <i />
              <i />
            </>
          ) : null}
        </span>
        <img
          src={TILE_SHEET.src}
          alt=""
          draggable={false}
          style={
            scale
              ? {
                  width: TILE_SHEET.w * scale,
                  height: TILE_SHEET.h * scale,
                  marginLeft: -x * scale,
                  marginTop: -y * scale,
                }
              : {
                  position: 'absolute',
                  width: `${(TILE_SHEET.w / w) * 100}%`,
                  height: `${(TILE_SHEET.h / w) * aspect * 100}%`,
                  left: `${(-x / w) * 100}%`,
                  top: `${(-y / w) * aspect * 100}%`,
                  margin: 0,
                }
          }
        />
      </span>
    </span>
  );
}
