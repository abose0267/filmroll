import { fetchPhotoBlob } from './photos';

/** Saves a developed photo's original to the device (share sheet on iOS where "Save Image" lives). */
export async function downloadPhoto(gid: string, rid: string, pid: string, frame: number): Promise<'shared' | 'downloaded'> {
  const blob = await fetchPhotoBlob(gid, rid, pid, 'original', true);
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `filmroll-frame-${frame}.${ext}`, { type: blob.type || 'image/jpeg' });
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/** Explicit, user-initiated share of a single developed memory outside the group. */
export async function shareMemory(gid: string, rid: string, pid: string, frame: number, caption: string): Promise<boolean> {
  const blob = await fetchPhotoBlob(gid, rid, pid, 'display');
  const file = new File([blob], `filmroll-frame-${frame}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption ? `“${caption}” — shot on FilmRoll` : 'Shot on FilmRoll' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function shareInvite(url: string, groupName: string): Promise<'shared' | 'copied'> {
  const text = `Join ${groupName} on FilmRoll — a shared disposable camera for us.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'FilmRoll', text, url });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
