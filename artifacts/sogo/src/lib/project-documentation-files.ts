const DOCUMENTATION_FILE_LIMITS = {
  pdf: 4_500_000,
  image: 3_750_000,
  imageDimension: 8_000,
} as const;

function fileExtension(filename: string) {
  const lower = filename.toLowerCase();
  return ['.pdf', '.png', '.jpg', '.jpeg'].find((extension) => lower.endsWith(extension));
}

export async function getProjectDocumentationFileError(file: File) {
  const extension = fileExtension(file.name);
  if (!extension) {
    return 'Obsługiwane są PDF, PNG i JPG/JPEG.';
  }

  if (extension === '.pdf') {
    return file.size <= DOCUMENTATION_FILE_LIMITS.pdf
      ? undefined
      : 'Plik PDF przekracza limit 4,5 MB.';
  }

  if (file.size > DOCUMENTATION_FILE_LIMITS.image) {
    return 'Obraz przekracza limit 3,75 MB.';
  }

  try {
    const image = await createImageBitmap(file);
    const exceedsLimit =
      image.width > DOCUMENTATION_FILE_LIMITS.imageDimension
      || image.height > DOCUMENTATION_FILE_LIMITS.imageDimension;
    image.close();
    return exceedsLimit
      ? 'Obraz może mieć maksymalnie 8000 × 8000 px.'
      : undefined;
  } catch {
    return 'Nie udało się odczytać wymiarów obrazu. Sprawdź, czy plik jest prawidłowym PNG lub JPG.';
  }
}