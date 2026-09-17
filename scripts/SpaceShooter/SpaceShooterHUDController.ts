/**
 * SpaceShooterHUDController — Drives the score and health HUD.
 *
 * Component Attachment: SpaceShooterHUD scene entity (with CustomUi)
 * Component Networking: Local (client-only display)
 * Component Ownership: Not networked
 *
 * Subscribes to OnSpaceShooterScoreChangedEvent for score updates.
 * Polls CharacterGASComponent health each frame for the health bar.
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnPlayerCreateEvent,
  OnPlayerCreateEventPayload,
  OnSafeZonesChangeEvent,
  OnEntityDestroyEvent,
  ExecuteOn,
  CustomUiComponent,
  TransformComponent,
  PlayerService,
  CameraService,
  NetworkingService,
  UiViewModel,
  uiViewModel,
  Service,
  UiService,
} from 'meta/worlds';
import type {Entity, Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {CharacterGASComponent, MAX_HEALTH_ATTR} from '../gas/CharacterGASComponent';
import {HEALTH_ATTR} from '../gas/weapons/core/WeaponSetup';
import {
  OnSpaceShooterScoreChangedEvent,
  SpaceShooterScorePayload,
} from './SpaceShooterEvents';
import {SpaceShooterScoreManager} from './SpaceShooterScoreManager';

const REF_W = 1080;
const REF_H = 1920;
const HEALTH_BAR_MAX_WIDTH = 160;

@uiViewModel()
export class SpaceShooterHUDViewModel extends UiViewModel {
  override readonly events = {};
  scoreText: string = '0';
  healthText: string = '100';
  healthBarWidth: number = HEALTH_BAR_MAX_WIDTH;
  healthBarColor: string = '#33FF4D';
  safeAreaMargin: string = '0,0,0,0';
}

@component({
  description:
    'Drives the space shooter HUD (score + health). Attach to the HUD scene entity with CustomUi.',
})
export class SpaceShooterHUDController extends Component {
  private viewModel = new SpaceShooterHUDViewModel();
  private customUi: Maybe<CustomUiComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private gasComp: Maybe<CharacterGASComponent> = null;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    this.customUi = this.entity.getComponent(CustomUiComponent);
    if (this.customUi) {
      this.customUi.dataContext = this.viewModel;
    }

    // Read initial score from ScoreManager if available
    const scoreMgr = SpaceShooterScoreManager.instance;
    if (scoreMgr) {
      this.viewModel.scoreText = String(scoreMgr.score);
    }

    this.refreshPlayer();
    this.updateSafeArea();
    console.log('[SpaceShooterHUDController] Initialized');
  }

  @subscribe(OnPlayerCreateEvent, {execution: ExecuteOn.Everywhere})
  onPlayerCreate(payload: OnPlayerCreateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (payload.isLocal) {
      this.refreshPlayer();
    }
  }

  @subscribe(OnSpaceShooterScoreChangedEvent, {execution: ExecuteOn.Everywhere})
  onScoreChanged(payload: SpaceShooterScorePayload): void {
    if (NetworkingService.get().isServerContext()) return;
    this.viewModel.scoreText = String(payload.score);
    console.log(`[SpaceShooterHUDController] Score updated: ${payload.score}`);
  }

  @subscribe(OnSafeZonesChangeEvent, {execution: ExecuteOn.Everywhere})
  onSafeZonesChanged(): void {
    this.updateSafeArea();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    if (!this.gasComp) {
      this.refreshPlayer();
    }
    if (!this.gasComp) return;

    // Read health from GAS attribute
    const health = this.gasComp.getAttributeValue(HEALTH_ATTR) ?? 0;
    const maxHealth = this.gasComp.getAttributeValue(MAX_HEALTH_ATTR) ?? 100;
    const healthPct = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;

    this.viewModel.healthText = String(Math.ceil(health));
    this.viewModel.healthBarWidth = Math.round(healthPct * HEALTH_BAR_MAX_WIDTH);

    // Color: green > yellow > red
    if (healthPct > 0.5) {
      this.viewModel.healthBarColor = '#33FF4D';
    } else if (healthPct > 0.25) {
      this.viewModel.healthBarColor = '#FFE619';
    } else {
      this.viewModel.healthBarColor = '#FF3333';
    }
  }

  private refreshPlayer(): void {
    if (NetworkingService.get().isServerContext()) return;
    const player = PlayerService.get().getLocalPlayer();
    if (player) {
      this.playerEntity = player;
      this.gasComp = player.getComponent(CharacterGASComponent);
    }
  }

  private updateSafeArea(): void {
    const safe = Service.get(UiService).getSafeZone();
    const aspect = Service.get(CameraService).aspectRatio;
    if (!Number.isFinite(aspect) || aspect <= 0) {
      this.viewModel.safeAreaMargin = '0,0,0,0';
      return;
    }
    const designW = Math.max(REF_W, REF_H * aspect);
    const designH = Math.max(REF_H, REF_W / aspect);
    const left = safe.x * designW;
    const top = safe.y * designH;
    const right = (1 - safe.x - safe.width) * designW;
    const bottom = (1 - safe.y - safe.height) * designH;
    this.viewModel.safeAreaMargin = `${left},${top},${right},${bottom}`;
  }
}
