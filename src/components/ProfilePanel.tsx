'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AvatarBadge, AvatarPicker } from './AvatarPicker';

interface UserLite {
  id: string;
  username: string;
  avatar: string;
  avatarUrl: string | null;
}

export function ProfilePanel({ user }: { user: UserLite }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState(user.avatar);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
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
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? 'Upload failed');
      return;
    }
    const j = await r.json();
    setAvatarUrl(j.avatarUrl);
    router.refresh();
  }

  async function removeUpload() {
    setBusy(true);
    const r = await fetch('/api/profile/avatar', { method: 'DELETE' });
    setBusy(false);
    if (r.ok) { setAvatarUrl(null); router.refresh(); }
  }

  return (
    <div className="card-panel">
      <div className="flex items-center gap-3">
        <AvatarBadge id={avatar} url={avatarUrl ?? undefined} size={64} />
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
          <div className="text-xs text-ink-500 mb-2">Or upload an image (JPEG/PNG/WEBP, ≤ 5 MB)</div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={upload}
              className="text-xs"
            />
            {avatarUrl && (
              <button className="btn text-xs" onClick={removeUpload} disabled={busy}>Remove</button>
            )}
          </div>
        </div>
        {err && <div className="text-red-400 text-xs">{err}</div>}
      </div>
    </div>
  );
}
