'use client';

import { useState } from 'react';
import Image from 'next/image';

interface ProfileCardProps {
    user: { name: string; image?: string | null };
    onLogout: () => void;
}

/**
 * The player's identity, standing in the sky rather than bolted to it.
 *
 * This used to be a card: a rounded rectangle in the corner with an avatar, a
 * name and a sign-out link, cut from the same stock as every other surface in
 * the product. The first rule says the world should occupy the screen, so the
 * chrome that sits in the world is unframed. What separates this from the
 * nebula now is weight, a ring around the avatar, and a pool of shade that
 * fades out before it reaches the frame. There is no box to be pasted on.
 */
export default function ProfileCard({ user, onLogout }: ProfileCardProps) {
    const [imageError, setImageError] = useState(false);

    return (
        <div className="relative flex items-center gap-3">
            {/*
              A pool of shade rather than a card. It darkens the sky directly
              behind the identity so the name stays legible over a bright
              nebula, and it has no edge of its own: the gradient falls to
              nothing well before the frame.
            */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-8 -inset-y-5 bg-[radial-gradient(70%_100%_at_16%_50%,rgba(2,4,8,0.85)_0%,rgba(2,4,8,0.45)_45%,transparent_72%)]"
            />

            {/*
              The avatar is a mark, not a widget: a tight radius, a hairline
              ring and one flat backdrop, so that a photograph and the letter
              tile that stands in for a missing one are the same object. The
              photograph is pulled to monochrome, because these are Google's own
              avatars and they arrive in whatever colour the account was given,
              and a menu with one accent should not have a second colour in its
              corner.
            */}
            <div className="relative w-9 h-9 rounded-[var(--radius-control)] overflow-hidden bg-zinc-800/70 ring-1 ring-inset ring-white/10 shrink-0 flex items-center justify-center">
                {user.image && !imageError ? (
                    <Image
                        src={user.image}
                        alt={user.name}
                        width={36}
                        height={36}
                        className="w-full h-full object-cover grayscale opacity-90"
                        onError={() => setImageError(true)}
                        unoptimized
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center font-mono font-bold text-xs text-zinc-300 uppercase">
                        {user.name ? user.name.charAt(0) : 'U'}
                    </div>
                )}
                {/* No status pip. A green dot here asserted an online state the
                    client never verifies, and the label beside it made the same
                    unverified claim a second time in words. */}

            </div>

            {/*
              Name and the way out. The altitude used to sit here as a chip and
              also in a panel in the middle of the menu, showing the same number
              twice. The menu shows it once now.
            */}
            <div className="relative flex flex-col min-w-0">
                <span className="text-[15px] font-semibold text-zinc-100 tracking-tight leading-tight truncate max-w-36 md:max-w-48 text-readout">
                    {user.name}
                </span>
                <button
                    onClick={onLogout}
                    className="self-start font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-[color] duration-150 cursor-pointer"
                >
                    Sign out
                </button>
            </div>
        </div>
    );
}
