/**
 * SpaceShooterHUDController — Drives the score, health, shield, wave, timer,
 * hit-flash, and powerup HUD.
 *
 * Component Attachment: SpaceShooterHUD scene entity (with CustomUi)
 * Component Networking: Local (client-only display)
 * Component Ownership: Not networked
 *
 * Subscribes to score/wave/shield/victory events; polls GAS health and the
 * damage receiver (hit-flash) and ShootControlsBridge (powerup timer) each frame.
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
  WorldService,
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
  OnSpaceShooterWaveChangedEvent,
  OnSpaceShooterVictoryEvent,
  SpaceShooterScorePayload,
  SpaceShooterWavePayload,
} from './SpaceShooterEvents';
import {SpaceShooterScoreManager} from './SpaceShooterScoreManager';
import {SpaceShooterDamageReceiver} from './SpaceShooterDamageReceiver';
import {ShootControlsBridge} from '../ShootControlsBridge';

const REF_W = 1080;
const REF_H = 1920;
const HEALTH_BAR_MAX_WIDTH = 160;
const SHIELD_BAR_MAX_WIDTH = 160;
const HIT_FLASH_SECONDS = 0.3;

@uiViewModel()
export class SpaceShooterHUDViewModel extends UiViewModel {
  override readonly events = {};
  scoreText: string = '0';
  healthText: string = '100';
  healthBarWidth: number = HEALTH_BAR_MAX_WIDTH;
  healthBarColor: string = '#33FF4D';
  shieldText: string = '50';
  shieldBarWidth: number = SHIELD_BAR_MAX_WIDTH;
  shieldBarColor: string = '#33CCFF';
  waveText: string = '';
  timerText: string = '0:00';
  hitFlashOpacity: number = 0;
  powerupText: string = '';
  safeAreaMargin: string = '0,0,0,0';
}

@component({
  description:
    'Drives the space shooter HUD (score + health + shield + wave + timer). Attach to the HUD scene entity with CustomUi.',
})
export class SpaceShooterHUDController extends Component {
  private viewModel = new SpaceShooterHUDViewModel();
  private customUi: Maybe<CustomUiComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private gasComp: Maybe<CharacterGASComponent> = null;
  private receiver: Maybe<SpaceShooterDamageReceiver> = null;
  private bridge: Maybe<ShootControlsBridge> = null;
  private timerStart: number = -1;
  private timerFrozen: number = 0;
  private timerRunning: boolean = false;

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

  @subscribe(OnSpaceShooterWaveChangedEvent, {execution: ExecuteOn.Everywhere})
  onWaveChanged(payload: SpaceShooterWavePayload): void {
    if (NetworkingService.get().isServerContext()) return;
    this.viewModel.waveText = `WAVE ${payload.wave}/${payload.totalWaves}`;
    if (payload.wave === 1) {
      // (Re)start the mission timer on wave 1 — also fires on restart
      this.timerStart = WorldService.get().getWorldTime();
      this.timerFrozen = 0;
      this.timerRunning = true;
      this.viewModel.powerupText = '';
    }
    console.log(`[SpaceShooterHUDController] ${this.viewModel.waveText}`);
  }

  @subscribe(OnSpaceShooterVictoryEvent, {execution: ExecuteOn.Everywhere})
  onVictory(): void {
    if (NetworkingService.get().isServerContext()) return;
    this.freezeTimer();
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

    const now = WorldService.get().getWorldTime();

    // Health bar
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

    if (health <= 0 && this.timerRunning) {
      this.freezeTimer();
    }

    // Shield bar (polled from the damage receiver)
    if (this.receiver) {
      const shield = this.receiver.getShield();
      const shieldMax = this.receiver.getShieldMax();
      const shieldPct = shieldMax > 0 ? Math.max(0, Math.min(1, shield / shieldMax)) : 0;
      this.viewModel.shieldText = String(Math.ceil(shield));
      this.viewModel.shieldBarWidth = Math.round(shieldPct * SHIELD_BAR_MAX_WIDTH);
      this.viewModel.shieldBarColor = shieldPct > 0 ? '#33CCFF' : '#226688';

      // Hit-flash: bright red overlay fading over HIT_FLASH_SECONDS
      const sinceHit = now - this.receiver.getLastHitTime();
      this.viewModel.hitFlashOpacity =
        sinceHit < HIT_FLASH_SECONDS ? 1 - sinceHit / HIT_FLASH_SECONDS : 0;
    }

    // Powerup indicator
    if (this.bridge) {
      const mode = this.bridge.getWeaponMode();
      if (mode === 'single') {
        this.viewModel.powerupText = '';
      } else {
        const secs = Math.ceil(this.bridge.getWeaponTimeLeft());
        this.viewModel.powerupText = `${mode.toUpperCase()} ${secs}s`;
      }
    }

    // Mission timer
    if (this.timerRunning && this.timerStart >= 0) {
      this.viewModel.timerText = this.formatTime(now - this.timerStart);
    } else if (!this.timerRunning && this.timerStart >= 0) {
      this.viewModel.timerText = this.formatTime(this.timerFrozen);
    }
  }

  private freezeTimer(): void {
    if (this.timerRunning && this.timerStart >= 0) {
      this.timerFrozen = WorldService.get().getWorldTime() - this.timerStart;
    }
    this.timerRunning = false;
  }

  private formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  private refreshPlayer(): void {
    if (NetworkingService.get().isServerContext()) return;
    const player = PlayerService.get().getLocalPlayer();
    if (player) {
      this.playerEntity = player;
      this.gasComp = player.getComponent(CharacterGASComponent);
      this.receiver = player.getComponent(SpaceShooterDamageReceiver);
      this.bridge = player.getComponent(ShootControlsBridge);
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
