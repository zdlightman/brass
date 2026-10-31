export type Era = 1 | 2;
export type PlayerId = 0 | 1 | 2 | 3;

export type IndustryFamily =
  | 'kerosene'
  | 'coal'
  | 'manufacturing'
  | 'coke'
  | 'iron'
  | 'steel'
  | 'automobile';

export type IndustryKind = IndustryFamily | 'oilCity' | 'polyphase' | 'locomotive' | 'skyscraper';

export type Cube = 'coal' | 'iron' | 'coke' | 'steel';
export type Resource = Cube | 'oil';

export type LinkKind = 'lightTrain' | 'heavyTrain' | 'pipeline';

export type HeavyTrainType =
  | 'whiskey'
  | 'cokeResource'
  | 'steelResource'
  | 'oilResource'
  | 'doubleLink'
  | 'replacement';

export type PipelineType = 'income' | 'money' | 'vp' | 'reserve';

export type LocationKind = 'city' | 'merchant';

export type CardKind = 'location' | 'industry';

export interface Cost {
  money: number;
  coal: number;
  iron: number;
  coke: number;
  steel: number;
  /** Red arrows on the tile: income levels, not track spaces. */
  incomeSpaces: number;
  /** Connected oil spent as the industry is built. Manufacturing III spends one barrel. */
  oil?: number;
}

export interface FlipReward {
  money: number;
  incomeSpaces: number;
  whiskey: number;
  vp: number;
  bonusSell: boolean;
  freeDevelops: number;
  doubleIncome: boolean;
  /** Kept for older rewards. Oilfield faces do not grant a light train. */
  lightTrains?: number;
}

export interface TileDef {
  id: string;
  kind: IndustryKind;
  family: IndustryFamily;
  level: number;
  era: Era | 'any';
  cost: Cost;
  produces: Partial<Record<Resource, number>>;
  oilToSell: number;
  stars: number;
  vp: number;
  linkPoints: number;
  flipReward: FlipReward;
  alreadyFlipped: boolean;
  upgradeFrom: IndustryKind | null;
  sellable: boolean;
  unlockLinkIds: string[];
  nextIds: string[];
  crownJewel: 'oilCity' | 'polyphase' | 'locomotive' | 'skyscraper' | null;
  /** Era VP is the player's income level when the era is scored. Manufacturing II. */
  eraScore?: 'incomeLevel';
}

export interface SlotDef {
  id: string;
  allowed: IndustryKind[];
  exclusive?: IndustryKind;
}

export interface LocationDef {
  id: string;
  name: string;
  kind: LocationKind;
  x: number;
  y: number;
  slots: SlotDef[];
  marketId?: string;
}

export interface RailDef {
  id: string;
  a: string;
  b: string;
  hue?: 'orange' | 'purple' | 'yellow';
  bonus?: { whiskey?: number; incomeSpaces?: number; lightTrains?: number; freeDevelop?: number };
}

export interface PipelineDef {
  id: string;
  city: string;
  oilfield: string;
  oil: number;
}

export interface MarketDef {
  id: string;
  name: string;
  locationId: string;
  cubes: Cube[];
  price: number;
  slotVp: number[];
}

export interface OilfieldDef {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface MapData {
  locations: LocationDef[];
  railLines: RailDef[];
  pipelineLines: PipelineDef[];
  markets: MarketDef[];
  oilfields: OilfieldDef[];
  vanderbilt: Record<Cube, number>;
}

export interface CardDef {
  id: string;
  kind: CardKind;
  locationId?: string;
  industry?: IndustryKind;
  playerCounts: number[];
  label: string;
}

export interface MerchantTileDef {
  id: string;
  /** Index into the four gold/red merchant pictures. The picture is this tile. */
  art: number;
  industries: IndustryKind[];
  money: number;
  whiskey: number;
  incomeSpaces: number;
  vp: number;
}

export interface OilfieldTileDef {
  id: string;
  revealReward: Partial<FlipReward>;
  era2Oil: number;
}

export interface QualityRewardDef {
  id: string;
  stars: number;
  money: number;
  whiskey: number;
  incomeSpaces: number;
  vp: number;
}

export interface Card {
  id: string;
  defId: string;
}

export interface MatTile {
  defId: string;
  removed: boolean;
}

export interface SlotState {
  id: string;
  locationId: string;
  tileDefId: string | null;
  owner: PlayerId | null;
  flipped: boolean;
  cubes: Partial<Record<Resource, number>>;
}

export interface LinkState {
  id: string;
  lineId: string;
  kind: LinkKind;
  owner: PlayerId;
  heavyType?: HeavyTrainType;
  pipelineType?: PipelineType;
  /** Copied from the supply piece so oil travel can pay the printed reward. */
  pipelineIncome?: number;
  pipelinePoints?: number;
  cubes: Partial<Record<Resource, number>>;
  doubleLink: boolean;
}

export interface MarketState {
  id: string;
  slots: Array<{ cube: Cube | null; vp: number }>;
}

export interface OilfieldState {
  id: string;
  tileId: string | null;
  revealed: boolean;
  oil: number;
  pendingEra2Oil: number;
  oilCitySlot: SlotState | null;
}

export interface MerchantState {
  locationId: string;
  tileId: string;
  faceUp: boolean;
  /** Which of the four gold/red merchant pictures. Only the four placed markets use it. */
  art: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  money: number;
  incomeSpace: number;
  vp: number;
  whiskey: number;
  hand: Card[];
  discard: Card[];
  mat: MatTile[];
  lightTrains: number;
  heavySupply: Array<{ type: HeavyTrainType }>;
  pipelineSupply: Array<{ type: PipelineType; incomeSpaces?: number; points?: number }>;
  lockedHeavies: Array<{ type: HeavyTrainType; unlockAfter: string }>;
  lockedPipes: Array<{ type: PipelineType; unlockAfter: string; incomeSpaces?: number; points?: number }>;
  heavyTrainsBuilt: number;
  pendingFreeDevelops: number;
  character: string;
}

export interface LogEntry {
  text: string;
}

export interface GameState {
  playerCount: 4;
  seed: number;
  rng: number;
  era: Era;
  round: number;
  actionsTaken: number;
  actionsAllowed: number;
  currentPlayerId: PlayerId;
  turnOrder: PlayerId[];
  spentThisRound: Record<PlayerId, number>;
  playersActed: PlayerId[];
  players: PlayerState[];
  deck: Card[];
  setupDiscards: Card[];
  slots: SlotState[];
  links: LinkState[];
  markets: MarketState[];
  oilfields: OilfieldState[];
  merchants: MerchantState[];
  qualityRewards: Array<{ id: string; faceUp: boolean; art?: number; stars?: number }>;
  log: LogEntry[];
  winner: PlayerId | null;
  over: boolean;
  /** Set when a skyscraper was just built. The bonus sell resolves before the turn ends. */
  bonusSellPlayerId: PlayerId | null;
  /** A covered road or a revealed oilfield just granted one free develop. The player removes one accessible industry or skips. */
  pendingOilDevelopPlayerId: PlayerId | null;
  /** The network action that granted the free develop should end once it is resolved. */
  oilDevelopThenFinish: boolean;
  /** Both actions are done. The turn advances only after the player confirms. */
  pendingConfirm: boolean;
  /** Era 1 actions are finished. Scoring and removal have not run, so the board can be reviewed. */
  eraScoreHeld: boolean;
}

export type CubeSource =
  | { kind: 'industry'; slotId: string; cube?: Cube }
  | { kind: 'oilCity'; oilfieldId: string }
  | { kind: 'market'; marketId: string; cube?: Cube }
  | { kind: 'heavyTrain'; linkId: string; cube?: Cube }
  | { kind: 'vanderbilt'; cube?: Cube };

export type OilSource =
  | { kind: 'oilfield'; oilfieldId: string; pipelineLinkId: string }
  | { kind: 'oilCity'; oilfieldId: string; pipelineLinkId: string }
  | { kind: 'heavyTrain'; linkId: string };

export type Action =
  | { type: 'pass'; playerId: PlayerId; cardId: string }
  | { type: 'loan'; playerId: PlayerId; cardId: string }
  | {
      type: 'develop';
      playerId: PlayerId;
      cardId: string;
      tileDefIds: string[];
      sources: CubeSource[];
    }
  | {
      type: 'network';
      playerId: PlayerId;
      cardId: string;
      placements: NetworkPlacement[];
      /** The optional second link. It spends $10 and does not discard another card. */
      secondLink?: boolean;
    }
  | {
      type: 'build';
      playerId: PlayerId;
      cardId: string;
      whiskeyWild: boolean;
      tileDefId: string;
      slotId?: string;
      oilfieldId?: string;
      /** Barrel spent while building, when more than one connected source can pay. */
      oilSource?: OilSource;
      sources: CubeSource[];
      /** Empty slots to fill, in the order the player chose. */
      sales?: Array<{ marketId: string; slotIndex: number }>;
    }
  | { type: 'declineSell'; playerId: PlayerId }
  | { type: 'oilDevelop'; playerId: PlayerId; tileDefId: string }
  | { type: 'declineOilDevelop'; playerId: PlayerId }
  | {
      type: 'sell';
      playerId: PlayerId;
      cardId: string;
      slotIds: string[];
      /** Empty when every chosen industry has exactly one legal merchant. */
      merchantLocationIds: string[];
      /** Each entry is one barrel for one industry. Empty when that industry has only one legal source. */
      oilSources: Array<OilSource & { slotId: string }>;
      whiskeyStars: number;
      qualityRewardId?: string;
    };

export interface NetworkPlacement {
  lineId: string;
  kind: LinkKind;
  heavyType?: HeavyTrainType;
  pipelineType?: PipelineType;
  points?: number;
  replaceLinkId?: string;
  sources: CubeSource[];
}

export interface ActionError {
  ok: false;
  error: string;
}

export interface ActionOk {
  ok: true;
  state: GameState;
}

export type ActionResult = ActionError | ActionOk;
