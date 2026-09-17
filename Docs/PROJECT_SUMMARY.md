# Star Fox-Style 3D Space Shooter

A complete 3D space shooter game inspired by Star Fox. The player pilots a spaceship through deep space, shooting down enemy ships while avoiding damage.

## What works the moment you press play

- **Move** — WASD or the left joystick moves the spaceship left/right/up/down in the play area (±15 X, 1–10 Y). The ship visually banks when strafing.
- **Shoot** — Hold the Fire button (or auto-fires on hold) to shoot cyan laser bolts forward. Bolts travel at high speed and despawn after 2 seconds or on collision.
- **Enemies** — Enemy ships spawn every 2.5 seconds ahead of the player at random positions, fly toward the player, and fire red plasma bolts periodically.
- **Score** — Destroying an enemy awards +100 points. Score is displayed live in the HUD.
- **Health** — Player has a health bar (top-right HUD). Taking damage reduces it; reaching zero triggers Game Over.
- **Game Over** — Shows final score and a Restart button that revives the player and resets the score.

## The scene

| Entity | What it does |
|--------|--------------|
| `StartingWorld` | Scene root. Player spawns as the spaceship. |
| `SpawnPoint` | Where the player ship appears. |
| `Camera` | Chase camera behind the ship (distance=12, height=3, FOV=65). |
| `PlayerInputServices` | Movement stick + Shoot button wired here. |
| `TouchControl` | On-screen joystick + Fire HUD button. |
| `EnemySpawner` | Spawns enemy ships every 2.5s ahead of the player. |
| `ScoreManager` | Server-authoritative networked score tracker. |
| `SpaceShooterHUD` | Score (top-center) + health bar (top-right) UI. |
| `GameOverScreen` | Overlay shown on player death with final score + restart. |

## The player ship

`Templates/PlayerCharacter.hstf` — default character replaced with a sci-fi fighter mesh.

- `SpaceShipController` — overrides locomotion for free-flight X/Y movement, visual banking tilt ±30°
- `ProjectileShooter` + `ShootAction` + `ShootControlsBridge` — hold-to-auto-fire at 0.2s intervals
- `CharacterGASComponent` — health and death (existing system)

## Enemy system

- `Templates/GameplayObjects/EnemyShip.hstf` — cone mesh enemy with `EnemyShipController`
- `EnemyShipController` — moves toward player at 8 m/s, fires every 3s, collision deals damage
- `EnemySpawner` — spawns enemies 50 units ahead at random X/Y offsets

## Projectiles

- `Templates/GameplayObjects/Bullet.hstf` — player laser bolt (sphere, speed=50, lifetime=2s)
- `Templates/GameplayObjects/EnemyProjectile.hstf` — enemy plasma bolt (sphere, 15 damage on hit)

## Scripts

| Folder | What is in it |
|--------|---------------|
| `scripts/SpaceShooter/` | SpaceShipController, EnemyShipController, EnemySpawner, SpaceShooterScoreManager, SpaceShooterDamageReceiver, SpaceShooterEvents, SpaceShooterHUD, GameOverController |

## Art direction

- Deep space skybox, floor disabled, dim blue/purple ambient + strong directional light
- Player ship: silver/blue sci-fi fighter
- Enemy ships: angular red/orange fighters
- Player projectiles: cyan laser bolts; enemy projectiles: red plasma bolts
- HUD: cyan/white text on dark semi-transparent background (Teko font)
