export const APO_CHAT_MAX_ATTACHMENTS = 5;
export const APO_CHAT_MAX_MAIL_TEXT_LENGTH = 20_000;
export const APO_CHAT_PDF_MAX_BYTES = 4_500_000;
export const APO_CHAT_IMAGE_MAX_BYTES = 3_750_000;
export const APO_CHAT_IMAGE_MAX_DIMENSION = 8_000;

export type ApoChatFileMetadata = Pick<File, 'name' | 'size' | 'type'>;

function extensionOf(filename: string) {
  const name = filename.toLowerCase();
  return ['.pdf', '.png', '.jpg', '.jpeg'].find((extension) => name.endsWith(extension));
}

export function getApoChatFileValidationError(file: ApoChatFileMetadata): string | null {
  const extension = extensionOf(file.name);
  if (!extension) {
    return 'Załączniki asystenta obsługują tylko PDF, PNG i JPG. XLSX, EML, MSG i DOCX nie są obsługiwane.';
  }

  if (extension === '.pdf') {
    if (file.type && file.type !== 'application/pdf') return 'Typ pliku nie zgadza się z rozszerzeniem PDF.';
    if (file.size > APO_CHAT_PDF_MAX_BYTES) return 'Plik PDF może mieć maksymalnie 4 500 000 bajtów.';
    return null;
  }

  const allowedImageTypes = extension === '.png' ? ['image/png'] : ['image/jpeg', 'image/jpg'];
  if (file.type && !allowedImageTypes.includes(file.type)) {
    return 'Typ pliku nie zgadza się z rozszerzeniem PNG/JPG.';
  }
  if (file.size > APO_CHAT_IMAGE_MAX_BYTES) return 'Obraz może mieć maksymalnie 3 750 000 bajtów.';
  return null;
}

export async function validateApoChatFile(file: File): Promise<void> {
  const validationError = getApoChatFileValidationError(file);
  if (validationError) throw new Error(validationError);

  if (!extensionOf(file.name)?.match(/^\.(png|jpe?g)$/)) return;

  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('Nie udało się odczytać wymiarów obrazu.'));
      image.src = objectUrl;
    });
    if (
      dimensions.width > APO_CHAT_IMAGE_MAX_DIMENSION
      || dimensions.height > APO_CHAT_IMAGE_MAX_DIMENSION
    ) {
      throw new Error('Obraz może mieć maksymalnie 8000 × 8000 pikseli.');
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function makeClipboardScreenshotFilename(contentType: string, date = new Date()): string {
  const extension = contentType === 'image/png'
    ? 'png'
    : contentType === 'image/jpeg'
      ? 'jpg'
      : null;
  if (!extension) throw new Error('Schowek zawiera obraz w nieobsługiwanym formacie. Użyj PNG lub JPG.');

  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `zrzut-${stamp}.${extension}`;
}

export function makeClipboardScreenshotFile(blob: Blob, date = new Date()): File {
  return new File(
    [blob],
    makeClipboardScreenshotFilename(blob.type, date),
    { type: blob.type, lastModified: date.getTime() },
  );
}