/**
 * SpaceShooterGameOverManager — Detects player death and shows the Game Over screen.
 *
 * Component Attachment: Scene entity (GameOverScreen) with CustomUi
 * Component Networking: Local (client-only UI)
 * Component Ownership: Not networked
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
  ExecuteOn,
  CustomUiComponent,
  TransformComponent,
  Quaternion,
  PlayerService,
  CameraService,
  NetworkingService,
  UiViewModel,
  uiViewModel,
  UiEvent,
  Service,
  UiService,
  Vec3,
} from 'meta/worlds';
import type {Entity, Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {CharacterGASComponent, DEAD_TAG, MAX_HEALTH_ATTR} from '../gas/CharacterGASComponent';
import {HEALTH_ATTR} from '../gas/weapons/core/WeaponSetup';
import {CharacterStateMachine} from '../Character/State/CharacterStateMachine';
import {SpaceShooterScoreManager} from './SpaceShooterScoreManager';
import {EnemySpawner} from './EnemySpawner';
import {
  OnSpaceShooterVictoryEvent,
  SpaceShooterScorePayload,
} from './SpaceShooterEvents';

const REF_W = 1080;
const REF_H = 1920;

// Module-level UiEvent for the restart button Command binding
export const onRestartEvent = new UiEvent('SpaceShooterGameOver-onRestart');

@uiViewModel()
export class SpaceShooterGameOverViewModel extends UiViewModel {
  override readonly events = {
    onRestart: onRestartEvent,
  };

  finalScoreText: string = '0';
  safeAreaMargin: string = '0,0,0,0';
}

@component({
  description:
    'Game Over manager. Detects player death, shows game over screen, handles restart.',
})
export class SpaceShooterGameOverManager extends Component {
  private viewModel = new SpaceShooterGameOverViewModel();
  private customUi: Maybe<CustomUiComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private gasComp: Maybe<CharacterGASComponent> = null;
  private gameOver: boolean = false;
  private deathDetected: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    this.customUi = this.entity.getComponent(CustomUiComponent);
    if (this.customUi) {
      this.customUi.dataContext = this.viewModel;
      this.customUi.isVisible = false;
    }
    this.refreshPlayer();
    this.updateSafeArea();
    console.log('[SpaceShooterGameOverManager] Initialized');
  }

  @subscribe(OnPlayerCreateEvent, {execution: ExecuteOn.Everywhere})
  onPlayerCreate(payload: OnPlayerCreateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (payload.isLocal) this.refreshPlayer();
  }

  @subscribe(OnSafeZonesChangeEvent, {execution: ExecuteOn.Everywhere})
  onSafeZonesChanged(): void {
    this.updateSafeArea();
  }

  // Subscribe to the restart UiEvent from the button Command binding
  @subscribe(onRestartEvent)
  onRestart(): void {
    this.handleRestart();
  }

  @subscribe(OnSpaceShooterVictoryEvent, {execution: ExecuteOn.Everywhere})
  onVictory(payload: SpaceShooterScorePayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (this.gameOver) return;
    this.gameOver = true;
    // NOTE: the overlay XAML title is hardcoded "GAME OVER"; the human can
    // rebind it in GenStudio, or we add a title binding in a later round.
    this.viewModel.finalScoreText = String(payload.score);
    if (this.customUi) this.customUi.isVisible = true;
    console.log(`[SpaceShooterGameOverManager] SECTOR CLEARED! Score: ${payload.score}`);
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (this.gameOver) return;
    if (!this.gasComp) this.refreshPlayer();
    if (!this.gasComp) return;

    const health = this.gasComp.getAttributeValue(HEALTH_ATTR) ?? 0;
    if (health <= 0 && !this.deathDetected) {
      this.deathDetected = true;
      setTimeout(() => this.showGameOver(), 1500);
    }
  }

  private showGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    const score = SpaceShooterScoreManager.instance?.score ?? 0;
    this.viewModel.finalScoreText = String(score);
    if (this.customUi) this.customUi.isVisible = true;
    console.log(`[SpaceShooterGameOverManager] Game Over! Score: ${score}`);
  }

  private handleRestart(): void {
    console.log('[SpaceShooterGameOverManager] Restart requested');
    if (this.customUi) this.customUi.isVisible = false;
    this.gameOver = false;
    this.deathDetected = false;

    // Reset score (RPC routes to server owner)
    SpaceShooterScoreManager.instance?.resetScore();

    // Reset waves (RPC routes to server owner): clears live enemies, restarts wave 1
    EnemySpawner.instance?.resetWaves();

    // Revive player (client-owned, so client can modify directly)
    if (this.playerEntity && this.gasComp) {
      const maxHealth = this.gasComp.getAttributeValue(MAX_HEALTH_ATTR) ?? 100;
      this.gasComp.setAttributeBase(HEALTH_ATTR, maxHealth);
      this.gasComp.removeLooseTag(DEAD_TAG);

      const stateMachine = this.playerEntity.getComponent(CharacterStateMachine);
      if (stateMachine) stateMachine.setDead(false);

      const transform = this.playerEntity.getComponent(TransformComponent);
      if (transform) {
        transform.worldPosition = new Vec3(0, 3, 0);
        transform.worldRotation = Quaternion.identity;
      }
      console.log('[SpaceShooterGameOverManager] Player revived');
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
