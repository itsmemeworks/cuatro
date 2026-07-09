/**
 * Avatar file storage on the Fly volume — same convention as @cuatro/db's
 * DATABASE_PATH (client.ts): an env var override for prod, a local relative
 * default for dev, both living under the single `/data` mount (fly.toml's
 * `[[mounts]]`). One file per user, named by id, always re-encoded to JPEG
 * client-side before upload (see components/entry/selfie-camera.tsx) so
 * there's exactly one format to store and serve.
 */
import fs from "node:fs";
import path from "node:path";

function avatarDir(): string {
  return process.env.AVATAR_DIR ?? path.join(process.cwd(), "avatars");
}

export function avatarFilePath(userId: string): string {
  // userId is always a crypto.randomUUID() (idColumn()) — never
  // attacker-controlled path segments — but guard anyway since this
  // resolves straight to a filesystem path.
  if (!/^[a-zA-Z0-9-]+$/.test(userId)) throw new Error(`avatarFilePath: invalid userId "${userId}"`);
  return path.join(avatarDir(), `${userId}.jpg`);
}

export function saveAvatarJpeg(userId: string, buffer: Buffer): void {
  fs.mkdirSync(avatarDir(), { recursive: true });
  fs.writeFileSync(avatarFilePath(userId), buffer);
}

export function readAvatarJpeg(userId: string): Buffer | null {
  const file = avatarFilePath(userId);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
