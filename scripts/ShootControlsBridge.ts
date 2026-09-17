/**
 * ShootControlsBridge — Bridges the on-screen 'Shoot' hold-button to
 * ShootAction.fireShot() with a client-side fire interval.
 *
 * Component Attachment: Player entity (alongside ShootAction)
 * Component Networking: Local (runs on Owner only)
 * Component Ownership: Player (client-owned)
 *
 * The Shoot button is hold (momentary=false): pressed=true while held,
 * false on release. This bridge polls isPressed('Shoot') each frame and
 * calls fireShot() on a cooldown so the player holds to auto-fire.
 */

import {
  Component,
  component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnEntityDestroyEvent,
  ExecuteOn,
  WorldService,
} from 'meta/worlds';
import type {Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {InputActionsManager} from './Input/InputActionsManager';
import {ShootAction} from './ShootAction';

const FIRE_INTERVAL = 0.2; // seconds between shots while held

@component({
  description:
    'Fires ShootAction on a cooldown while the Shoot button is held. Attach to player entity alongside ShootAction.',
})
export class ShootControlsBridge extends Component {
  private shootAction: Maybe<ShootAction> = null;
  private lastFireTime: number = 0;
  private wired: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Owner})
  onStart(): void {
    this.shootAction = this.entity.getComponent(ShootAction);
    this.wire();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!this.wired) {
      this.wire();
    }

    const manager = InputActionsManager.instance;
    if (!manager || !this.shootAction) {
      return;
    }

    if (manager.isPressed('Shoot')) {
      const now = WorldService.get().getWorldTime();
      if (now - this.lastFireTime >= FIRE_INTERVAL) {
        this.shootAction.fireShot();
        this.lastFireTime = now;
      }
    }
  }

  @subscribe(OnEntityDestroyEvent, {execution: ExecuteOn.Owner})
  onDestroy(): void {
    this.wired = false;
  }

  private wire(): void {
    if (this.wired) {
      return;
    }
    if (InputActionsManager.instance == null) {
      return;
    }
    this.shootAction = this.entity.getComponent(ShootAction);
    if (this.shootAction) {
      this.wired = true;
      console.log('[ShootControlsBridge] Wired to ShootAction');
    }
  }
}
