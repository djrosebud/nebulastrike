/**
 * SpaceShipController — Overrides ground locomotion with free-flight X/Y plane movement.
 *
 * Component Attachment: PlayerCharacter root entity
 * Component Networking: Local (client-owned, runs on Owner)
 * Component Ownership: Player (client-owned)
 *
 * Twin-stick: the left/bottom floating stick (TouchJoystick, 'Move' action) steers
 * the ship; a second floating stick registered here on the complementary screen
 * half drives aim. Deflecting the aim stick also fires (no separate fire button
 * needed on touch). On desktop (no mouse-position API in this SDK), aim falls
 * back to the movement direction, or straight forward when stationary.
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
  Vec2,
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
import {TouchRouter, TouchHoldMode} from '../Input/TouchRouter';

const BOUND_X = 15;
const BOUND_Y = 10;
const MIN_Y = 1;
const SHIP_SPEED = 12;
const BANK_ANGLE_DEG = 30;
const BANK_LERP_SPEED = 8;

// Aim stick tuning (mirrors TouchJoystick): normalized screen units.
const AIM_RADIUS = 0.12;
const AIM_DEADZONE = 0.08;
const AIM_FIRE_THRESHOLD = 0.3;
// Nose yaw/pitch toward the aim stick, in degrees.
const AIM_YAW_DEG = 25;
const AIM_PITCH_DEG = 12;
const AIM_NOSE_LERP_SPEED = 10;

@component({
  description:
    'Space ship flight controller. Overrides ground locomotion with free-flight X/Y plane movement. Attach to PlayerCharacter root.',
})
export class SpaceShipController extends Component {
  /** false = portrait split (default), true = landscape split. Mirrors TouchJoystick. */
  // NOTE: plain field (not @property) to avoid touching the editor-owned scene;
  // flip in code if the project ships landscape-first.
  private aimLandscape: boolean = false;

  private inputX: number = 0;
  private inputY: number = 0;
  private currentBankAngle: number = 0;
  private currentAimYaw: number = 0;
  private currentAimPitch: number = 0;
  private transform: Maybe<TransformComponent> = null;
  private visualsTransform: Maybe<TransformComponent> = null;
  private moveSub: Maybe<EventSubscription> = null;
  private wired: boolean = false;

  // Aim stick state (floating stick, origin at touch-down).
  private aimActiveIndex: Maybe<number> = null;
  private aimOriginX: number = 0;
  private aimOriginY: number = 0;
  private aimX: number = 0;
  private aimY: number = 0;

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

    // Second floating stick for aim on the complementary screen half.
    // zPriority 60 sits above the movement stick (50); passThrough:false
    // consumes the touch so the background camera-look drag (zPriority 0)
    // does not also fire on the aim half.
    TouchRouter.register({
      id: 'aimStick',
      zPriority: 60,
      passThrough: false,
      holdMode: TouchHoldMode.HoldUntilRelease,
      hitTest: (pos: Vec2) => this.isInAimZone(pos),
      handlers: {
        onStart: (index: number, pos: Vec2) => this.onAimStart(index, pos),
        onMove: (index: number, pos: Vec2) => this.onAimMove(index, pos),
        onEnd: (index: number) => this.onAimEnd(index),
      },
    });

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
    TouchRouter.unregister('aimStick');
    this.aimActiveIndex = null;
    this.aimX = 0;
    this.aimY = 0;
  }

  /**
   * Aim direction for projectiles, in world space. Forward-biased: the stick
   * nudges aim laterally/vertically around the -Z flight direction.
   */
  public getAimDirection(): Vec3 {
    const aimMag = Math.hypot(this.aimX, this.aimY);
    let ax = 0;
    let ay = 0;
    if (this.aimActiveIndex !== null && aimMag > 0.05) {
      ax = this.aimX;
      ay = this.aimY;
    } else if (Math.hypot(this.inputX, this.inputY) > 0.2) {
      // Desktop fallback (no mouse-position API): shoot where you fly.
      ax = this.inputX;
      ay = this.inputY;
    }
    return new Vec3(ax, ay, -1).normalize();
  }

  /** True while the aim stick is deflected enough to auto-fire. */
  public isAimFiring(): boolean {
    return this.aimActiveIndex !== null && Math.hypot(this.aimX, this.aimY) > AIM_FIRE_THRESHOLD;
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

  /** Portrait: top half (y < 0.5). Landscape: right half (x >= 0.5). */
  private isInAimZone(pos: Vec2): boolean {
    return this.aimLandscape ? pos.x >= 0.5 : pos.y < 0.5;
  }

  private onAimStart(index: number, pos: Vec2): void {
    if (this.aimActiveIndex !== null && this.aimActiveIndex !== index) return;
    this.aimActiveIndex = index;
    this.aimOriginX = pos.x;
    this.aimOriginY = pos.y;
    this.aimX = 0;
    this.aimY = 0;
  }

  private onAimMove(index: number, pos: Vec2): void {
    if (index !== this.aimActiveIndex) return;
    // Screen Y grows downward; stick Y is +1 = up.
    const dx = (pos.x - this.aimOriginX) / AIM_RADIUS;
    const dy = -(pos.y - this.aimOriginY) / AIM_RADIUS;
    const mag = Math.hypot(dx, dy);
    if (mag < AIM_DEADZONE) {
      this.aimX = 0;
      this.aimY = 0;
      return;
    }
    const clampedMag = Math.min(mag, 1);
    const scaledMag = Math.min(
      Math.max((clampedMag - AIM_DEADZONE) / (1 - AIM_DEADZONE), 0),
      1,
    );
    this.aimX = (dx / mag) * scaledMag;
    this.aimY = (dy / mag) * scaledMag;
  }

  private onAimEnd(index: number): void {
    if (index !== this.aimActiveIndex) return;
    this.aimActiveIndex = null;
    this.aimX = 0;
    this.aimY = 0;
  }

  private applyBanking(dt: number): void {
    if (!this.visualsTransform) return;
    const targetBank = -this.inputX * BANK_ANGLE_DEG;
    this.currentBankAngle += (targetBank - this.currentBankAngle) * Math.min(1, BANK_LERP_SPEED * dt);

    const aiming = this.aimActiveIndex !== null && Math.hypot(this.aimX, this.aimY) > 0.05;
    const targetYaw = aiming ? this.aimX * AIM_YAW_DEG : 0;
    const targetPitch = aiming ? -this.aimY * AIM_PITCH_DEG : 0;
    const k = Math.min(1, AIM_NOSE_LERP_SPEED * dt);
    this.currentAimYaw += (targetYaw - this.currentAimYaw) * k;
    this.currentAimPitch += (targetPitch - this.currentAimPitch) * k;

    this.visualsTransform.localRotation = Quaternion.fromEuler(
      new Vec3(this.currentAimPitch, 180 + this.currentAimYaw, this.currentBankAngle),
    );
  }
}
