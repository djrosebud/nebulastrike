/**
 * SpaceShooterScoreManager — Server-owned score tracker singleton.
 *
 * Component Attachment: Scene entity (server-owned)
 * Component Networking: Networked
 * Component Ownership: Server
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnEntityDestroyEvent,
  ExecuteOn,
  property,
  NetworkingService,
  rpc,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';
import {
  OnSpaceShooterScoreChangedEvent,
  SpaceShooterScorePayload,
} from './SpaceShooterEvents';

@component({
  description: 'Server-owned score tracker for the space shooter. Attach to a scene entity.',
})
export class SpaceShooterScoreManager extends Component {
  public static instance: Maybe<SpaceShooterScoreManager> = null;

  @property({isNetworked: true})
  public score: number = 0;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    SpaceShooterScoreManager.instance = this;
    console.log('[SpaceShooterScoreManager] Initialized');
  }

  @subscribe(OnEntityDestroyEvent, {execution: ExecuteOn.Everywhere})
  onDestroy(): void {
    if (SpaceShooterScoreManager.instance === this) {
      SpaceShooterScoreManager.instance = null;
    }
  }

  public addScore(amount: number): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.score += amount;
    console.log(`[SpaceShooterScoreManager] Score: ${this.score}`);
    this.entity.sendEventToEveryone(
      OnSpaceShooterScoreChangedEvent,
      new SpaceShooterScorePayload(this.score),
    );
  }

  @rpc()
  public resetScore(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.score = 0;
    this.entity.sendEventToEveryone(
      OnSpaceShooterScoreChangedEvent,
      new SpaceShooterScorePayload(0),
    );
  }
}
