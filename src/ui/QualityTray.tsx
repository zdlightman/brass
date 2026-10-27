import type { GameState } from '../engine/types';
import { MEEPLE_SHEET, QUALITY_BACK, QUALITY_SPRITE } from './meepleArt';

export function QualityTray({ rewards }: { rewards: GameState['qualityRewards'] }) {
  return (
    <div className="premium-deals" aria-label="Quality stars">
      {[...rewards]
        .sort((a, b) => (a.stars ?? 0) - (b.stars ?? 0))
        .map((reward) => {
          const stars = reward.stars ?? 0;
          const box = reward.faceUp ? (reward.art == null ? undefined : QUALITY_SPRITE[reward.art]) : QUALITY_BACK;
          const scale = box ? 128 / box.w : 1;
          return (
            <div key={reward.id} className={reward.faceUp ? 'premium-slot' : 'premium-slot spent'}>
              <span className="premium-stars">{'★'.repeat(stars)}</span>
              <span
                className="premium-card"
                style={
                  box
                    ? {
                        backgroundSize: `${MEEPLE_SHEET.w * scale}px ${MEEPLE_SHEET.h * scale}px`,
                        backgroundPosition: `${-box.x * scale}px ${-box.y * scale}px`,
                      }
                    : undefined
                }
              />
            </div>
          );
        })}
    </div>
  );
}
