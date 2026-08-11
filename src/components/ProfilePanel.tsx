'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AvatarBadge, AvatarPicker } from './AvatarPicker';
import { resizeToSquareWebp } from '@/lib/imageResize';

interface UserLite {
  id: string;
  username: string;
  avatar: string;
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
}

export function ProfilePanel({ user }: { user: UserLite }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState(user.avatar);
  const [updatedAt, setUpdatedAt] = useState<string | null>(user.avatarUpdatedAt);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickStandard(id: string) {
    setAvatar(id);
    setBusy(true);
    const r = await fetch('/api/profile/avatar-id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatar: id }),
    });
    setBusy(false);
    if (!r.ok) setErr('Could not save avatar'); else router.refresh();
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      // Client-side resize to 512×512 WebP so the request body stays small and
      // the persisted Postgres blob is compact (typical ~30–150 KB).
      const blob = await resizeToSquareWebp(f, 512, 0.85);
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar.webp', { type: 'image/webp' }));
      const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? 'Upload failed');
        return;
      }
      const j = await r.json();
      setUpdatedAt(j.avatarUpdatedAt);
      router.refresh();
    } catch (ex) {
      setErr(`Could not process image: ${(ex as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeUpload() {
    setBusy(true);
    const r = await fetch('/api/profile/avatar', { method: 'DELETE' });
    setBusy(false);
    if (r.ok) { setUpdatedAt(null); router.refresh(); }
  }

  return (
    <div className="card-panel">
      <div className="flex items-center gap-3">
        <AvatarBadge
          user={{ id: user.id, avatar, avatarUrl: user.avatarUrl, avatarUpdatedAt: updatedAt }}
          size={64}
        />
        <div>
          <div className="text-lg font-semibold">{user.username}</div>
          <div className="text-xs text-ink-500 mt-1">Profile</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <div>
          <div className="text-xs text-ink-500 mb-2">Choose a standard avatar</div>
          <AvatarPicker value={avatar} onChange={pickStandard} />
        </div>
        <div>
          <div className="text-xs text-ink-500 mb-2">Or upload an image (JPEG/PNG/WEBP, ≤ 5 MB — resized to 512×512)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={upload}
              className="text-xs"
              disabled={busy}
            />
            {updatedAt && (
              <button className="btn text-xs" onClick={removeUpload} disabled={busy}>Remove</button>
            )}
          </div>
        </div>
        {err && <div className="text-red-400 text-xs">{err}</div>}
        {busy && <div className="text-ink-500 text-xs">Processing…</div>}
      </div>
    </div>
  );
}
