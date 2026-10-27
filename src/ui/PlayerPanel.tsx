import { buildPlacementError } from '../engine/actions/build';
import { merchantsForSale, oilChoices } from '../engine/actions/sell';
import { cardDef, location, merchantTiles, qualityRewards, tile } from '../engine/catalog';
import { legalActions } from '../engine/legal';
import type { Action, CubeSource, GameState, NetworkPlacement, OilSource, PlayerId } from '../engine/types';
import { CITY_NAME, cardFace } from './cardArt';
import { IncomeTrack } from './IncomeTrack';
import { PANEL_TOKEN } from './meepleArt';
import { PlayerMat } from './PlayerMat';

export type ActionKind = 'pass' | 'loan' | 'network' | 'build' | 'develop' | 'sell';

const ACTION_CHOICES: { kind: ActionKind; label: string }[] = [
  { kind: 'pass', label: '跳过' },
  { kind: 'loan', label: '贷款' },
  { kind: 'network', label: '连接' },
  { kind: 'build', label: '建造' },
  { kind: 'develop', label: '研发' },
  { kind: 'sell', label: '售卖' },
];

export function PlayerPanel({
  state,
  playerId,
  interactive = false,
  selectedCardId,
  onSelectCard,
  onAction,
  actionKind,
  onChooseAction,
  onUndo,
  onRestart,
  secondLink = false,
  onPassSecond,
  onConfirmSecond,
  onConfirmTurn,
  linkChoices = [],
  onPickLink,
  networkDraft,
  resourceHint,
  onBuyOutside,
  sourcesReady = true,
  buildTileId,
  whiskeyWild,
  onWhiskeyWild,
  buildSlotId,
  buildOilfieldId,
  onSelectTile,
  developTileIds,
  sellSlotIds,
  sellMerchantIds,
  sellOil,
  sellWhiskeyStars,
  sellQualityId,
  onSellWhiskey,
  onSellQuality,
  onSellMerchant,
  sellHint,
  buildSources,
  buildOilSource,
  developSources,
  sales,
  notice,
}: {
  state: GameState;
  playerId: PlayerId;
  interactive?: boolean;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onAction: (action: Action) => void;
  actionKind: ActionKind | null;
  onChooseAction: (kind: ActionKind) => void;
  onUndo: () => void;
  onRestart: () => void;
  secondLink?: boolean;
  onPassSecond?: () => void;
  onConfirmSecond?: () => void;
  onConfirmTurn?: () => void;
  linkChoices?: { id: string; label: string; token: string; selected: boolean }[];
  onPickLink?: (id: string) => void;
  networkDraft: NetworkPlacement[];
  resourceHint?: string;
  onBuyOutside?: () => void;
  sourcesReady?: boolean;
  buildTileId: string | null;
  whiskeyWild: boolean;
  onWhiskeyWild: (v: boolean) => void;
  buildSlotId: string | null;
  buildOilfieldId: string | null;
  onSelectTile?: (tileDefId: string) => void;
  developTileIds?: string[];
  sellSlotIds?: string[];
  sellMerchantIds?: string[];
  sellOil?: Array<OilSource & { slotId: string }>;
  sellWhiskeyStars?: number;
  sellQualityId?: string | null;
  onSellWhiskey?: (stars: number) => void;
  onSellQuality?: (id: string | null) => void;
  onSellMerchant?: (locationId: string) => void;
  sellHint?: string;
  buildSources?: CubeSource[];
  buildOilSource?: OilSource | null;
  developSources?: CubeSource[];
  sales?: Array<{ marketId: string; slotIndex: number }>;
  notice?: string | null;
}) {
  void onSelectCard;
  const p = state.players[playerId]!;
  const active = state.currentPlayerId === playerId && !state.over;
  const turnRank = state.turnOrder.indexOf(playerId) + 1;
  const actionName = state.actionsAllowed <= 1 || state.actionsTaken === 0 ? '第一个动作' : '第二个动作';
  const legal = active ? legalActions(state, playerId) : [];
  const loanOk = legal.some((a) => a.type === 'loan');
  const buildOilPending = oilChoicePending(state, playerId, actionKind, buildTileId, buildSlotId, buildOilSource);
  const cardsReady = targetsReady(actionKind, {
    loanOk,
    networkDraft,
    buildTileId,
    buildSlotId,
    buildOilfieldId,
    developTileIds,
    sellSlotIds,
    sellHint,
    secondLink,
  }) && sourcesReady && !buildOilPending;

  function buildCardError(cardId: string): string | null {
    if (actionKind !== 'build' || !cardsReady || !buildTileId) return null;
    return buildPlacementError(state, {
      type: 'build',
      playerId,
      cardId,
      whiskeyWild,
      tileDefId: buildTileId,
      slotId: buildSlotId ?? undefined,
      oilfieldId: buildOilfieldId ?? undefined,
      oilSource: buildOilSource ?? undefined,
      sources: buildSources ?? [],
      sales,
    });
  }

  function cardPlayable(cardId: string): boolean {
    if (!actionKind || !cardsReady) return false;
    if (actionKind !== 'build') return true;
    return buildCardError(cardId) === null;
  }

  const handReady = actionKind === 'build' ? p.hand.some((card) => cardPlayable(card.id)) : cardsReady;
  const buildBlock = actionKind === 'build' && cardsReady && !handReady ? buildBlockText(state, buildSlotId, p.hand, buildCardError) : '';

  function submitChosen(kind: ActionKind, cardId: string) {
    if (!cardsReady) return;
    if (kind === 'pass') onAction({ type: 'pass', playerId, cardId });
    if (kind === 'loan') onAction({ type: 'loan', playerId, cardId });
    if (kind === 'network') {
      onAction({ type: 'network', playerId, cardId, placements: networkDraft });
    }
    if (kind === 'build' && buildTileId) {
      onAction({
        type: 'build',
        playerId,
        cardId,
        whiskeyWild,
        tileDefId: buildTileId,
        slotId: buildSlotId ?? undefined,
        oilfieldId: buildOilfieldId ?? undefined,
        oilSource: buildOilSource ?? undefined,
        sources: buildSources ?? [],
        sales,
      });
    }
    if (kind === 'develop' && developTileIds?.length) {
      onAction({
        type: 'develop',
        playerId,
        cardId,
        tileDefIds: developTileIds,
        sources: developSources ?? [],
      });
    }
    if (kind === 'sell' && sellSlotIds?.length) {
      onAction({
        type: 'sell',
        playerId,
        cardId,
        slotIds: sellSlotIds,
        merchantLocationIds: sellMerchantIds ?? [],
        oilSources: sellOil ?? [],
        whiskeyStars: sellWhiskeyStars ?? 0,
        qualityRewardId: sellQualityId || undefined,
      });
    }
  }

  const human = interactive || playerId === 0;

  return (
    <section className={`seat${playerId === 0 ? ' seat-lead' : ''}${active ? ' active' : ''}`} style={{ borderColor: p.color }}>
      <header>
        <strong style={{ color: p.color }}>{p.name}</strong>
        <span className="turn-order" aria-label={`本轮顺位 ${turnRank}`}>
          {turnRank > 0 ? turnRank : ''}
        </span>
        {active ? <span className="badge">acting</span> : null}
      </header>
      <p className="stats">
        ${p.money} · VP {p.vp} · whiskey {p.whiskey}
      </p>
      <IncomeTrack space={p.incomeSpace} color={p.color} />
      <p className="supply">
        <Token name="light" color={p.color} />
        <span>×{p.lightTrains}</span>
        {p.heavySupply.map((heavy, index) => (
          <Token key={`${heavy.type}-${index}`} name={heavyToken(heavy.type)} color={p.color} />
        ))}
        {p.pipelineSupply.map((pipe, index) => (
          <Token key={`${pipe.type}-${index}`} name={pipeToken(pipe)} color={p.color} />
        ))}
      </p>
      <PlayerMat
        playerId={playerId}
        name={p.name}
        mat={p.mat}
        selectedTileId={active ? buildTileId : null}
        selectedTileIds={active ? developTileIds : undefined}
        onSelectTile={
          state.pendingOilDevelopPlayerId === playerId
            ? (tileDefId) => onAction({ type: 'oilDevelop', playerId, tileDefId })
            : active && (actionKind === 'build' || actionKind === 'develop')
              ? onSelectTile
              : undefined
        }
        forceOpen={state.pendingOilDevelopPlayerId === playerId || (active && actionKind === 'develop')}
        pickOnMat={state.pendingOilDevelopPlayerId === playerId || (active && actionKind === 'develop')}
        color={p.color}
        lockedKeys={[
          ...p.lockedHeavies.map((heavy) => heavy.unlockAfter),
          ...p.lockedPipes.map((pipe) => pipe.unlockAfter),
        ]}
      />
      {/* mat */}
      <div className={handReady ? 'hand ready' : 'hand'}>
        {p.hand.map((card) => {
          const def = cardDef(card.defId);
          const face = cardFace(def);
          const selected = selectedCardId === card.id && active;
          const playable = cardPlayable(card.id);
          const shownW = 132;
          const city = def.kind === 'location' && def.locationId ? CITY_NAME[def.locationId] : null;
          const shownH = face ? Math.round((shownW * face.h) / face.w) : 0;
          const scale = face ? shownW / face.w : 1;
          return (
            <button
              key={card.id}
              type="button"
              className={selected ? 'card selected' : 'card'}
              disabled={!human || !active || !playable}
              aria-label={def.label}
              title={active && actionKind === 'build' && !playable ? zhBuild(buildCardError(card.id) ?? '') : undefined}
              onClick={() => actionKind && playable && submitChosen(actionKind, card.id)}
            >
              {face ? (
                <span className="card-face" style={{ width: shownW, height: shownH }}>
                  <img
                    src={face.src}
                    alt=""
                    draggable={false}
                    style={{
                      width: face.sheetW * scale,
                      height: face.sheetH * scale,
                      marginLeft: -face.x * scale,
                      marginTop: -face.y * scale,
                    }}
                  />
                  {city ? (
                    <span className="card-name">
                      <b>{city.zh}</b>
                      <small>{city.en}</small>
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="card-missing">{def.label}</span>
              )}
            </button>
          );
        })}
      </div>
      {human && active && state.pendingOilDevelopPlayerId === playerId ? (
        <div className="actions">
          <span className="muted action-hint">
            这次连接送了一次免费研发。个人版图已打开，点一个现在能研发的产业，免费移除它。
          </span>
          <button type="button" onClick={() => onAction({ type: 'declineOilDevelop', playerId })}>
            跳过研发
          </button>
          <button type="button" className="action-undo" onClick={onUndo}>
            撤销上一步
          </button>
          <button type="button" className="action-undo" onClick={onRestart}>
            重新开始回合
          </button>
        </div>
      ) : null}
      {human && active && state.bonusSellPlayerId !== null && state.bonusSellPlayerId === playerId ? (
        <div className="actions">
          <button
            type="button"
            disabled={!sellSlotIds?.length || Boolean(sellHint && !sellHint.includes('品质星'))}
            onClick={() =>
              sellSlotIds?.length &&
              onAction({
                type: 'sell',
                playerId,
                cardId: '',
                slotIds: sellSlotIds,
                merchantLocationIds: sellMerchantIds ?? [],
                oilSources: sellOil ?? [],
                whiskeyStars: sellWhiskeyStars ?? 0,
                qualityRewardId: sellQualityId || undefined,
              })
            }
          >
            立即售卖
          </button>
          <button type="button" onClick={() => onAction({ type: 'declineSell', playerId })}>
            跳过
          </button>
          {sellHint ? <span className="muted">{sellHint}</span> : null}
          {sellSlotIds?.length ? (
            <SellExtras
              state={state}
              playerId={playerId}
              sellSlotIds={sellSlotIds}
              sellMerchantIds={sellMerchantIds ?? []}
              sellOil={sellOil ?? []}
              sellWhiskeyStars={sellWhiskeyStars ?? 0}
              sellQualityId={sellQualityId ?? null}
              onSellWhiskey={onSellWhiskey}
              onSellQuality={onSellQuality}
              onSellMerchant={onSellMerchant}
            />
          ) : null}
        </div>
      ) : null}
      {human && active && state.pendingConfirm ? (
        <div className="actions">
          <button type="button" onClick={onConfirmTurn}>
            确认
          </button>
          <button type="button" className="action-undo" onClick={onUndo}>
            撤销上一步
          </button>
          <button type="button" className="action-undo" onClick={onRestart}>
            重新开始回合
          </button>
          <span className="muted action-hint">
            {state.actionsAllowed <= 1
              ? '第一个动作已经做完。确认后交给下一位，也可以撤销。'
              : '第二个动作已经做完。确认后交给下一位，也可以撤销。'}
          </span>
        </div>
      ) : null}
      {human && active && !state.eraScoreHeld && !state.pendingConfirm && state.bonusSellPlayerId !== playerId && state.pendingOilDevelopPlayerId !== playerId ? (
        <div className="actions">
          {ACTION_CHOICES.map((choice) => (
            <button
              key={choice.kind}
              type="button"
              className={actionKind === choice.kind ? 'action-icon selected' : 'action-icon'}
              aria-label={choice.label}
              aria-pressed={actionKind === choice.kind}
              onClick={() => onChooseAction(choice.kind)}
            >
              <ActionGlyph kind={choice.kind} />
              <span>{choice.label}</span>
            </button>
          ))}
          <span className="muted action-hint">
            {buildBlock ||
              `现在是${actionName}。${
                notice ||
                actionHint(actionKind, loanOk, handReady, sellHint, buildTileId, buildSlotId, secondLink, (networkDraft?.length ?? 0) > 0, buildOilPending)
              }`}
          </span>
          {actionKind === 'network' && linkChoices.length > 0 ? (
            <span className="link-pick">
              {linkChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={choice.selected ? 'selected' : ''}
                  onClick={() => onPickLink?.(choice.id)}
                >
                  <Token name={choice.token} color={p.color} />
                  {choice.label}
                </button>
              ))}
            </span>
          ) : null}
          {actionKind === 'sell' && sellSlotIds?.length ? (
            <SellExtras
              state={state}
              playerId={playerId}
              sellSlotIds={sellSlotIds}
              sellMerchantIds={sellMerchantIds ?? []}
              sellOil={sellOil ?? []}
              sellWhiskeyStars={sellWhiskeyStars ?? 0}
              sellQualityId={sellQualityId ?? null}
              onSellWhiskey={onSellWhiskey}
              onSellQuality={onSellQuality}
              onSellMerchant={onSellMerchant}
            />
          ) : null}
          {resourceHint || onBuyOutside ? (
            <div className="link-pick">
              {resourceHint ? <span className="muted">{resourceHint}</span> : null}
              {onBuyOutside ? (
                <button type="button" onClick={onBuyOutside}>
                  外部购买
                </button>
              ) : null}
            </div>
          ) : null}
          {secondLink ? (
            <>
              <button type="button" onClick={onPassSecond}>
                跳过
              </button>
              <button
                type="button"
                disabled={(networkDraft?.length ?? 0) === 0 || !sourcesReady}
                onClick={onConfirmSecond}
              >
                确认连接
              </button>
            </>
          ) : null}
          <button type="button" className="action-undo" onClick={onUndo}>
            撤销上一步
          </button>
          <button type="button" className="action-undo" onClick={onRestart}>
            重新开始回合
          </button>
          {actionKind === 'build' ? (
            <label className="muted">
              <input
                type="checkbox"
                checked={whiskeyWild}
                disabled={p.whiskey < 1}
                onChange={(e) => onWhiskeyWild(e.target.checked)}
              />{' '}
              威士忌代替
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SellExtras({
  state,
  playerId,
  sellSlotIds,
  sellMerchantIds,
  sellOil,
  sellWhiskeyStars,
  sellQualityId,
  onSellWhiskey,
  onSellQuality,
  onSellMerchant,
}: {
  state: GameState;
  playerId: PlayerId;
  sellSlotIds: string[];
  sellMerchantIds: string[];
  sellOil: Array<OilSource & { slotId: string }>;
  sellWhiskeyStars: number;
  sellQualityId: string | null;
  onSellWhiskey?: (stars: number) => void;
  onSellQuality?: (id: string | null) => void;
  onSellMerchant?: (locationId: string) => void;
}) {
  const p = state.players[playerId]!;
  const merchantIds = new Set<string>(sellMerchantIds);
  let goodsStars = 0;
  for (const slotId of sellSlotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot?.tileDefId) continue;
    const def = tile(slot.tileDefId);
    goodsStars += def.stars;
    if (sellMerchantIds.length > 0) continue;
    const options = merchantsForSale(state, slot.locationId, def.kind);
    if (options.length === 1 && options[0]) merchantIds.add(options[0].locationId);
  }
  let merchantWhiskey = 0;
  for (const locationId of merchantIds) {
    const merchant = state.merchants.find((entry) => entry.locationId === locationId);
    const spec = merchantTiles.find((entry) => entry.id === merchant?.tileId);
    merchantWhiskey += spec?.whiskey ?? 0;
  }
  const whiskeyCap = p.whiskey + merchantWhiskey;
  const stars = goodsStars + sellWhiskeyStars;
  const merchantChoices = new Map<string, { name: string; faceUp: boolean }>();
  for (const slotId of sellSlotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot?.tileDefId) continue;
    for (const merchant of merchantsForSale(state, slot.locationId, tile(slot.tileDefId).kind)) {
      merchantChoices.set(merchant.locationId, {
        name: location(merchant.locationId)?.name ?? merchant.locationId,
        faceUp: merchant.faceUp,
      });
    }
  }
  return (
    <>
    {merchantChoices.size > 1 ? (
      <span className="link-pick">
        {[...merchantChoices].map(([locationId, merchant]) => (
          <button
            key={locationId}
            type="button"
            className={sellMerchantIds.includes(locationId) ? 'selected' : ''}
            onClick={() => onSellMerchant?.(locationId)}
          >
            {merchant.faceUp ? merchant.name : `${merchant.name}（红框）`}
          </button>
        ))}
      </span>
    ) : null}
    <span className="muted">
      {sellSlotIds.map((slotId) => {
        const slot = state.slots.find((entry) => entry.id === slotId);
        if (!slot?.tileDefId) return null;
        const def = tile(slot.tileDefId);
        const choices = oilChoices(state, playerId, [slot.locationId]);
        if (def.oilToSell === 0) return null;
        const picked = sellOil.filter((source) => source.slotId === slotId).length;
        if (choices.length < 2 && picked === 0) return null;
        return (
          <span key={slotId}>
            {` ${location(slot.locationId)?.name ?? slot.locationId} 石油 ${picked}/${def.oilToSell}，点版图上的管道`}
          </span>
        );
      })}
      <button type="button" disabled={sellWhiskeyStars <= 0} onClick={() => onSellWhiskey?.(sellWhiskeyStars - 1)}>
        −威士忌
      </button>
      <button
        type="button"
        disabled={sellWhiskeyStars >= whiskeyCap}
        onClick={() => onSellWhiskey?.(sellWhiskeyStars + 1)}
      >
        +威士忌
      </button>
      {state.qualityRewards
        .filter((reward) => reward.faceUp)
        .map((reward) => {
          const spec = qualityRewards.find((entry) => entry.id === reward.id);
          const need = spec?.stars ?? reward.stars ?? 0;
          const on = sellQualityId === reward.id;
          return (
            <button
              key={reward.id}
              type="button"
              disabled={!on && stars < need}
              onClick={() => onSellQuality?.(on ? null : reward.id)}
            >
              {on ? `取消 ${need}星` : `${need}星奖励`}
            </button>
          );
        })}
    </span>
    </>
  );
}

function heavyToken(type: string): string {
  if (type === 'steelResource') return 'steel';
  if (type === 'cokeResource') return 'coke';
  if (type === 'oilResource') return 'oil';
  if (type === 'doubleLink') return 'score';
  if (type === 'replacement') return 'swap';
  return 'whiskey';
}

function pipeToken(pipe: { type: string; incomeSpaces?: number; points?: number }): string {
  if (pipe.type === 'reserve') return 'broken';
  if (pipe.type === 'money') return 'money10';
  if (pipe.type === 'income') return 'income2';
  if (pipe.type === 'vp' && pipe.points === 7) return 'points7';
  if (pipe.type === 'vp' && pipe.points === 4) return 'points4';
  if (pipe.type === 'vp') return 'points3';
  return '';
}

function Token({ name, color }: { name: string; color: string }) {
  const token = PANEL_TOKEN[name];
  if (!token) return null;
  return (
    <span className="token-plate" style={{ ['--plate-color' as string]: color }}>
      <i
        className="token"
        aria-label={name}
        style={{
          width: token.w,
          height: token.h,
          backgroundPosition: token.pos,
          backgroundSize: token.size,
        }}
      />
    </span>
  );
}

function zhBuild(error: string): string {
  if (!error) return '这张牌不能在这里建造。';
  if (error.includes('Location card')) return '地点牌必须和这座城市一致。地点牌不用接到自己的路网。';
  if (error.includes('Industry cards must')) return '产业牌在你已经有建筑或线路之后，只能造在自己的路网上。';
  if (error.includes('does not match')) return '这张产业牌和所选建筑不是同一类。';
  if (error.includes('does not allow')) return '这个空位不能造这种建筑。';
  if (error.includes('exclusive')) return '这座城里还有专用空位，要先造在那里。两用空位要等专用空位占满。';
  if (error.includes('already have an industry')) return '第一纪元同一玩家在一座城市只能有一座建筑。';
  if (error.includes('connected oil') || error.includes('Choose which connected oil')) {
    return '有多条管道能供这桶油，请先点一条。';
  }
  if (error.includes('Choose which connected')) return '有多处免费资源，请先选择用哪一座建筑的。';
  if (error.includes('Cannot source oil') || error.includes('oil is not connected')) {
    return '接不到这桶油。管道要连到这座城市。';
  }
  if (error.includes('Can only upgrade')) return '只能升级一座在建造开始时已经翻面的对应产业。付资源不能先把它翻面。';
  if (error.includes('Income cannot drop')) return '收入不能再降。';
  if (error.includes('No steel') || error.includes('No iron') || error.includes('No coal') || error.includes('No coke')) {
    return '这个市场里已经没有这种资源了。可以改点别的市场，或外部购买。';
  }
  if (error.includes('Cannot source') || error.includes('not connected') || error.includes('Market is not')) {
    return '接不到这块产业要付的资源。同一座城里的市场可以直接用。';
  }
  if (error.startsWith('Need $')) return error.replace('Need $', '钱不够，需要 $').replace(' to build.', '。');
  return error;
}

function buildBlockText(
  state: GameState,
  slotId: string | null,
  hand: { id: string; defId: string }[],
  errorOf: (cardId: string) => string | null,
): string {
  const slot = state.slots.find((entry) => entry.id === slotId);
  const cityCard = hand.find((card) => {
    const def = cardDef(card.defId);
    return def.kind === 'location' && def.locationId === slot?.locationId;
  });
  return zhBuild(errorOf(cityCard?.id ?? hand[0]?.id ?? '') ?? '');
}

function targetsReady(
  kind: ActionKind | null,
  pick: {
    loanOk: boolean;
    networkDraft: NetworkPlacement[];
    buildTileId: string | null;
    buildSlotId: string | null;
    buildOilfieldId: string | null;
    developTileIds?: string[];
    sellSlotIds?: string[];
    sellHint?: string;
    secondLink?: boolean;
  },
): boolean {
  if (!kind) return false;
  if (kind === 'pass') return true;
  if (kind === 'loan') return pick.loanOk;
  if (kind === 'network') return !pick.secondLink && pick.networkDraft.length === 1;
  if (kind === 'build') {
    return Boolean(pick.buildTileId && (pick.buildTileId === 'oilCity' ? pick.buildOilfieldId : pick.buildSlotId));
  }
  if (kind === 'develop') {
    const count = pick.developTileIds?.length ?? 0;
    return count >= 1 && count <= 2;
  }
  return Boolean(pick.sellSlotIds?.length && !(pick.sellHint && !pick.sellHint.includes('品质星')));
}

function oilChoicePending(
  state: GameState,
  playerId: PlayerId,
  kind: ActionKind | null,
  tileId: string | null,
  slotId: string | null,
  chosen: OilSource | null | undefined,
): boolean {
  if (kind !== 'build' || !tileId || !slotId) return false;
  if (!(tile(tileId).cost.oil ?? 0)) return false;
  const slot = state.slots.find((entry) => entry.id === slotId);
  if (!slot) return false;
  return oilChoices(state, playerId, [slot.locationId]).length > 1 && !chosen;
}

function actionHint(
  kind: ActionKind | null,
  loanOk: boolean,
  ready: boolean,
  sellHint?: string,
  buildTileId?: string | null,
  buildSlotId?: string | null,
  secondLink?: boolean,
  lineChosen?: boolean,
  oilPending?: boolean,
): string {
  if (kind === 'pass') return '选择要打出的牌。';
  if (kind === 'loan') return loanOk ? '选择要打出的牌。收入降 3 级，获得 $30。' : '收入不能再降，无法贷款。';
  if (kind === 'network' && secondLink) {
    return lineChosen ? '确认这条连接，花费 $10。' : '可以再放一条连接，花费 $10。选好车和位置后确认，或跳过。';
  }
  if (kind === 'network') return ready ? '选择要打出的牌。' : '先选轻车、重车或管道，再点一条路。';
  if (kind === 'build') {
    if (oilPending) return '有多条管道能供这桶油，请点其中一条。';
    if (ready) return '选择要打出的牌。地点牌可以造这座城里对得上的空位，不用接到自己的路网。';
    if (buildTileId && !buildSlotId) {
      if (tile(buildTileId).upgradeFrom) return '再点一座开工时已经翻面的对应产业。付资源不能先把它翻面再升级。';
      return '再点地图上能放下这块产业的空格。地点牌不看路网。';
    }
    if (buildSlotId && !buildTileId) return '再点版图上的产业，然后打出牌。';
    return '点版图上的产业，或地图上的空格。两边都选定后再打出牌。';
  }
  if (kind === 'develop') return ready ? '选择要打出的牌。' : '在个人版图上点 1 个或 2 个可研发的产业。同一种有两块时可以点两次。';
  if (kind === 'sell') {
    const base = sellHint || '点自己未翻面的可售商品。可售的是煤油、制造和汽车。';
    return ready ? `${base} 选择要打出的牌。` : base;
  }
  return '先点一个动作。';
}

function ActionGlyph({ kind }: { kind: ActionKind }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 28,
    height: 28,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (kind === 'pass') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="10" height="14" rx="1.5" />
        <path d="M14 12h6M17 9l3 3-3 3" />
      </svg>
    );
  }
  if (kind === 'loan') {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="7" rx="6" ry="2.4" />
        <path d="M6 7v5c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V7" />
        <path d="M6 12v5c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v-5" />
      </svg>
    );
  }
  if (kind === 'network') {
    return (
      <svg {...common}>
        <circle cx="5" cy="16" r="2" />
        <circle cx="19" cy="8" r="2" />
        <path d="M7 15l10-6" />
        <path d="M5 8h6M8 5v6" />
      </svg>
    );
  }
  if (kind === 'build') {
    return (
      <svg {...common}>
        <path d="M4 20V10l8-6 8 6v10" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (kind === 'develop') {
    return (
      <svg {...common}>
        <rect x="4" y="12" width="7" height="8" rx="1" />
        <rect x="13" y="8" width="7" height="12" rx="1" />
        <path d="M7.5 9V5M7.5 5l-2 2M7.5 5l2 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 8h16v10H4z" />
      <path d="M4 12h16M9 8V6h6v2" />
    </svg>
  );
}
