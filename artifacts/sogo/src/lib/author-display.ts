export function displayAuthorName(name: string | null | undefined) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(trimmed)) {
    return 'Użytkownik';
  }
  return trimmed;
}

export function canManageUserDisplayName(role: string | null | undefined) {
  return role === 'ADMIN';
}

export function validateUserDisplayName(input: string) {
  const name = input.trim();
  if (!name) return { name, error: 'Podaj imię i nazwisko.' };
  if (name.length > 160) return { name, error: 'Imię i nazwisko może mieć maksymalnie 160 znaków.' };
  return { name, error: '' };
}