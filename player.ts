export function getOrCreatePlayerId(): string {
  const key = 'cronicas_player_id';
  let id = localStorage.getItem(key);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }

  return id;
}
