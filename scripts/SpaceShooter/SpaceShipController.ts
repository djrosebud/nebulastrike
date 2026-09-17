/**
 * SpaceShipController — Overrides ground locomotion with free-flight X/Y plane movement.
 *
 * Component Attachment: PlayerCharacter root entity
 * Component Networking: Local (client-owned, runs on Owner)
 * Component Ownership: Player (client-owned)
 */

import {
  component,
  Component,
  subscribe,
  ExecuteOn,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnEntityDestroyEvent,
  TransformComponent,
  Vec3,
  Quaternion,
  NetworkingService,
} from 'meta/worlds';
import type {
  Maybe,
  Entity,
  EventSubscription,
  OnWorldUpdateEventPayload,
} from 'meta/worlds';
import {MovementAbility} from '../Character/Abilities/MovementAbility';
import {JumpAbility} from '../Character/Abilities/JumpAbility';
import {AutoFaceRotationAbility} from '../Character/Abilities/AutoFaceRotationAbility';
import {
  InputActionsManager,
  InputActionChangeEvent,
} from '../Input/InputActionsManager';

const BOUND_X = 15;
const BOUND_Y = 10;
const MIN_Y = 1;
const SHIP_SPEED = 12;
const BANK_ANGLE_DEG = 30;
const BANK_LERP_SPEED = 8;

@component({
  description:
    'Space ship flight controller. Overrides ground locomotion with free-flight X/Y plane movement. Attach to PlayerCharacter root.',
})
export class SpaceShipController extends Component {
  private inputX: number = 0;
  private inputY: number = 0;
  private currentBankAngle: number = 0;
  private transform: Maybe<TransformComponent> = null;
  private visualsTransform: Maybe<TransformComponent> = null;
  private moveSub: Maybe<EventSubscription> = null;
  private wired: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Owner})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    this.transform = this.entity.getComponent(TransformComponent);

    const movement = this.entity.getComponent(MovementAbility);
    if (movement) { movement.setMovementBlocked(true); movement.stop(); }
    const jump = this.entity.getComponent(JumpAbility);
    if (jump) { jump.setJumpBlocked(true); }
    const autoFace = this.entity.getComponent(AutoFaceRotationAbility);
    if (autoFace) { autoFace.setRotationBlocked(true); }

    const children = this.entity.getChildren();
    for (const child of children) {
      if (child.name === 'Visuals') {
        this.visualsTransform = child.getComponent(TransformComponent);
        break;
      }
    }
    console.log('[SpaceShipController] Initialized');
    this.wireInput();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (!this.wired) this.wireInput();
    if (!this.transform) return;

    const dt = payload.deltaTime;
    const pos = this.transform.worldPosition;
    let newX = Math.max(-BOUND_X, Math.min(BOUND_X, pos.x + this.inputX * SHIP_SPEED * dt));
    let newY = Math.max(MIN_Y, Math.min(BOUND_Y, pos.y + this.inputY * SHIP_SPEED * dt));
    this.transform.worldPosition = new Vec3(newX, newY, pos.z);
    this.transform.worldRotation = Quaternion.identity;
    this.applyBanking(dt);
  }

  @subscribe(OnEntityDestroyEvent, {execution: ExecuteOn.Owner})
  onDestroy(): void {
    this.moveSub?.disconnect();
    this.moveSub = null;
  }

  private wireInput(): void {
    if (this.wired) return;
    const manager = InputActionsManager.instance;
    if (manager == null) return;
    this.moveSub = manager.subscribeAction('Move', (event: InputActionChangeEvent) => {
      const val = event.newValue as {x: number; y: number};
      this.inputX = val.x;
      this.inputY = val.y;
    });
    this.wired = true;
    console.log('[SpaceShipController] Wired to Move action');
  }

  private applyBanking(dt: number): void {
    if (!this.visualsTransform) return;
    const targetBank = -this.inputX * BANK_ANGLE_DEG;
    this.currentBankAngle += (targetBank - this.currentBankAngle) * Math.min(1, BANK_LERP_SPEED * dt);
    this.visualsTransform.localRotation = Quaternion.fromEuler(new Vec3(0, 180, this.currentBankAngle));
  }
}
