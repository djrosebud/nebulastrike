/**
 * EnemySpawner — Server-side wave-based enemy spawner.
 *
 * Component Attachment: Scene entity (server-owned)
 * Component Networking: Networked
 * Component Ownership: Server
 *
 * Runs 3 waves: two drone waves with escalating count/HP/speed, then a
 * single large boss (same enemy template, promoted via
 * EnemyShipController.configureAsBoss() and scaled 3x). A wave is cleared
 * when every spawned enemy is destroyed; after a short breather the next
 * wave begins. Clearing wave 3 broadcasts victory ("Sector Cleared").
 *
 * Spawning pauses while the player is dead. resetWaves() (RPC, called by
 * the game-over manager on restart) clears live enemies and restarts
 * wave 1.
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnEntityDestroyEvent,
  OnWorldUpdateEvent,
  OnPlayerCreateEvent,
  OnPlayerCreateEventPayload,
  ExecuteOn,
  WorldService,
  NetworkMode,
  NetworkingService,
  TransformComponent,
  Vec3,
  Quaternion,
  PlayerService,
  TemplateAsset,
  property,
  rpc,
} from 'meta/worlds';
import type {Entity, Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {EnemyShipController} from './EnemyShipController';
import {SpaceShooterScoreManager} from './SpaceShooterScoreManager';
import {CharacterGASComponent} from '../gas/CharacterGASComponent';
import {HEALTH_ATTR} from '../gas/weapons/core/WeaponSetup';
import {
  OnSpaceShooterWaveChangedEvent,
  OnSpaceShooterVictoryEvent,
  SpaceShooterWavePayload,
  SpaceShooterScorePayload,
} from './SpaceShooterEvents';

interface WaveDef {
  count: number;
  hp: number;
  speed: number;
  fireInterval: number;
  spawnInterval: number;
  boss: boolean;
}

const WAVES: WaveDef[] = [
  {count: 6, hp: 1, speed: 8, fireInterval: 3.0, spawnInterval: 2.2, boss: false},
  {count: 10, hp: 2, speed: 10, fireInterval: 2.4, spawnInterval: 1.6, boss: false},
  {count: 1, hp: 40, speed: 4.5, fireInterval: 2.5, spawnInterval: 1.0, boss: true},
];

const BREATHER_SECONDS = 4;
const BOSS_SCALE = 3;
const SPAWN_AHEAD_Z = -50;
const SPAWN_RANGE_X = 12;
const SPAWN_RANGE_Y = 8;
const SPAWN_MIN_Y = 2;

type SpawnerState = 'spawning' | 'breather' | 'done';

@component({
  description: 'Wave-based enemy spawner: 2 drone waves then a boss. Attach to a scene entity.',
})
export class EnemySpawner extends Component {
  public static instance: Maybe<EnemySpawner> = null;

  @property()
  enemyTemplate: Maybe<TemplateAsset> = null;

  private waveIndex: number = -1;
  private spawnedThisWave: number = 0;
  private pendingSpawns: number = 0;
  private generation: number = 0;
  private tracked: Entity[] = [];
  private state: SpawnerState = 'spawning';
  private nextActionTime: number = 0;
  private playerEntity: Maybe<Entity> = null;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    EnemySpawner.instance = this;
    if (!NetworkingService.get().isServerContext()) return;
    this.refreshPlayer();
    this.beginWave(0);
    console.log('[EnemySpawner] Wave spawner initialized on server');
  }

  @subscribe(OnEntityDestroyEvent, {execution: ExecuteOn.Everywhere})
  onDestroy(): void {
    if (EnemySpawner.instance === this) {
      EnemySpawner.instance = null;
    }
  }

  @subscribe(OnPlayerCreateEvent, {execution: ExecuteOn.Everywhere})
  onPlayerCreate(payload: OnPlayerCreateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.refreshPlayer();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.enemyTemplate) return;
    if (this.waveIndex < 0 || this.waveIndex >= WAVES.length) return;

    // Prune destroyed enemies from tracking
    if (this.tracked.length > 0) {
      this.tracked = this.tracked.filter((e) => !e.isDestroyed());
    }

    // Pause the wave machine while the player is dead
    if (!this.isPlayerAlive()) return;

    const wave = WAVES[this.waveIndex];
    const now = WorldService.get().getWorldTime();

    if (this.state === 'spawning') {
      if (this.spawnedThisWave < wave.count && now >= this.nextActionTime) {
        this.nextActionTime = now + wave.spawnInterval;
        this.spawnedThisWave++;
        this.pendingSpawns++;
        void this.spawnEnemy(wave, this.generation)
          .finally(() => {
            this.pendingSpawns--;
          })
          .catch((err) => console.error('[EnemySpawner] spawn failed:', err));
      } else if (
        this.spawnedThisWave >= wave.count &&
        this.pendingSpawns === 0 &&
        this.tracked.length === 0
      ) {
        this.onWaveCleared();
      }
    } else if (this.state === 'breather') {
      if (now >= this.nextActionTime) {
        this.beginWave(this.waveIndex + 1);
      }
    }
  }

  /**
   * Reset for a new run: destroy live enemies and restart wave 1.
   * Called via RPC from the game-over manager's restart flow.
   */
  @rpc()
  public resetWaves(): void {
    if (!NetworkingService.get().isServerContext()) return;
    for (const e of this.tracked) {
      if (!e.isDestroyed()) e.destroy();
    }
    this.tracked = [];
    console.log('[EnemySpawner] Waves reset for new run');
    this.beginWave(0);
  }

  private onWaveCleared(): void {
    console.log(`[EnemySpawner] Wave ${this.waveIndex + 1} cleared!`);
    if (this.waveIndex >= WAVES.length - 1) {
      this.state = 'done';
      const score = SpaceShooterScoreManager.instance?.score ?? 0;
      this.entity.sendEventToEveryone(
        OnSpaceShooterVictoryEvent,
        new SpaceShooterScorePayload(score),
      );
      console.log('[EnemySpawner] SECTOR CLEARED — victory!');
    } else {
      this.state = 'breather';
      this.nextActionTime = WorldService.get().getWorldTime() + BREATHER_SECONDS;
      console.log(`[EnemySpawner] Breather — next wave in ${BREATHER_SECONDS}s`);
    }
  }

  private beginWave(index: number): void {
    this.waveIndex = index;
    this.spawnedThisWave = 0;
    this.generation++;
    this.state = 'spawning';
    this.nextActionTime = WorldService.get().getWorldTime() + 1.0;
    const wave = WAVES[index];
    console.log(
      `[EnemySpawner] Wave ${index + 1}/${WAVES.length} incoming ` +
        `(${wave.boss ? 'BOSS' : wave.count + ' drones'})`,
    );
    this.entity.sendEventToEveryone(
      OnSpaceShooterWaveChangedEvent,
      new SpaceShooterWavePayload(index + 1, WAVES.length),
    );
  }

  private isPlayerAlive(): boolean {
    if (!this.playerEntity || this.playerEntity.isDestroyed()) {
      this.refreshPlayer();
      if (!this.playerEntity) return false;
    }
    const gas = this.playerEntity.getComponent(CharacterGASComponent);
    if (!gas) return true;
    return (gas.getAttributeValue(HEALTH_ATTR) ?? 1) > 0;
  }

  private refreshPlayer(): void {
    const players = PlayerService.get().getAllPlayers();
    this.playerEntity = players.length > 0 ? players[0] : null;
  }

  private async spawnEnemy(wave: WaveDef, generation: number): Promise<void> {
    if (!this.enemyTemplate || !this.playerEntity) return;

    const playerPos = this.playerEntity.getComponent(TransformComponent)?.worldPosition;
    if (!playerPos) return;

    const randomX = (Math.random() - 0.5) * 2 * SPAWN_RANGE_X;
    const randomY = SPAWN_MIN_Y + Math.random() * SPAWN_RANGE_Y;
    const spawnZ = playerPos.z + SPAWN_AHEAD_Z;
    const spawnPos = new Vec3(randomX, randomY, spawnZ);
    const dirToPlayer = playerPos.sub(spawnPos).normalize();
    const rotation = Quaternion.lookRotation(dirToPlayer, Vec3.up);

    try {
      const entity = await WorldService.get().spawnTemplate({
        templateAsset: this.enemyTemplate,
        networkMode: NetworkMode.Networked,
        position: spawnPos,
        rotation: rotation,
      });
      if (!entity || entity.isDestroyed()) return;
      // Drop late arrivals from a previous wave/run (e.g. after resetWaves)
      if (generation !== this.generation) {
        entity.destroy();
        return;
      }

      const ctrl = entity.getComponent(EnemyShipController);
      if (wave.boss) {
        ctrl?.configureAsBoss();
        const t = entity.getComponent(TransformComponent);
        if (t) t.worldScale = new Vec3(BOSS_SCALE, BOSS_SCALE, BOSS_SCALE);
        console.log('[EnemySpawner] BOSS spawned!');
      } else if (ctrl) {
        ctrl.hitPoints = wave.hp;
        ctrl.moveSpeed = wave.speed;
        ctrl.fireInterval = wave.fireInterval;
      }
      this.tracked.push(entity);
    } catch (err) {
      console.error('[EnemySpawner] Failed to spawn enemy:', err);
    }
  }
}
