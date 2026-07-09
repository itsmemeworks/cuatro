"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { SelfieCamera } from "@/components/entry/selfie-camera";

/**
 * The Profile header's avatar + camera badge (design/CUATRO-Prototype-LATEST.dc.html's
 * "Profile" screen: a 58px photo with a coral camera-badge affordance,
 * bottom-right, that opens the same Selfie camera the claim flow uses —
 * see components/entry/selfie-camera.tsx's header for why a denied/missing
 * camera degrades gracefully to the initials fallback.
 */
export function ProfileAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const router = useRouter();
  const [showCamera, setShowCamera] = useState(false);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl);

  return (
    <div className="relative flex-none">
      <Avatar src={currentAvatarUrl} name={name} size="lg" />
      <button
        type="button"
        onClick={() => setShowCamera(true)}
        aria-label="Change avatar"
        className="absolute -right-0.5 -bottom-0.5 w-6 h-6 rounded-full bg-action border-2 border-ground flex items-center justify-center"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      </button>
      {showCamera && (
        <SelfieCamera
          onClose={() => setShowCamera(false)}
          onSaved={(url) => {
            setCurrentAvatarUrl(url);
            setShowCamera(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
