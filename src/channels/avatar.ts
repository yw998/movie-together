export function avatarColor(username: string): string {
  const palette = ["#c75b4b", "#4d83b8", "#6d9852", "#9b62a5", "#c18a3f", "#4f9a92"];
  let hash = 0;
  for (const character of username) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

