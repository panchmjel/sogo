import type { OfferQuestionsFinding } from './api';
import { offerQuestionTargetLabel, publicOfferText } from './offer-questions-utils.ts';

export type PreparedOfferQuestionMail = {
  subject: string;
  body: string;
  findingKeys: string[];
};

export type OfferQuestionComposerSession = {
  selectedSupplierId: string | null;
  selectedFindingKeysBySupplier: Record<string, string[]>;
  preparedMailsBySupplier: Record<string, PreparedOfferQuestionMail>;
};

export const emptyOfferQuestionComposerSession = (): OfferQuestionComposerSession => ({
  selectedSupplierId: null,
  selectedFindingKeysBySupplier: {},
  preparedMailsBySupplier: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseOfferQuestionComposerSession(value: string | null): OfferQuestionComposerSession | null {
  if (value == null) return emptyOfferQuestionComposerSession();
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed)
      || (parsed.selectedSupplierId != null && typeof parsed.selectedSupplierId !== 'string')
      || !isRecord(parsed.selectedFindingKeysBySupplier)
      || !isRecord(parsed.preparedMailsBySupplier)
    ) {
      return null;
    }

    const selectedFindingKeysBySupplier: Record<string, string[]> = {};
    for (const [supplierId, findingKeys] of Object.entries(parsed.selectedFindingKeysBySupplier)) {
      if (!Array.isArray(findingKeys) || !findingKeys.every((key) => typeof key === 'string')) return null;
      selectedFindingKeysBySupplier[supplierId] = [...new Set(findingKeys)];
    }

    const preparedMailsBySupplier: Record<string, PreparedOfferQuestionMail> = {};
    for (const [supplierId, rawMail] of Object.entries(parsed.preparedMailsBySupplier)) {
      if (
        !isRecord(rawMail)
        || typeof rawMail.subject !== 'string'
        || rawMail.subject.length > 200
        || typeof rawMail.body !== 'string'
        || rawMail.body.length > 60_000
        || !Array.isArray(rawMail.findingKeys)
        || !rawMail.findingKeys.every((key) => typeof key === 'string')
      ) {
        return null;
      }
      preparedMailsBySupplier[supplierId] = {
        subject: rawMail.subject,
        body: rawMail.body,
        findingKeys: [...new Set(rawMail.findingKeys)],
      };
    }

    return {
      selectedSupplierId: typeof parsed.selectedSupplierId === 'string' ? parsed.selectedSupplierId : null,
      selectedFindingKeysBySupplier,
      preparedMailsBySupplier,
    };
  } catch {
    return null;
  }
}

export function offerQuestionFindingKey(finding: OfferQuestionsFinding, index: number) {
  return `${finding.targetId?.trim() || 'finding'}:${finding.status}:${index}`;
}

export function createOfferQuestionFindingTitle(finding: OfferQuestionsFinding, index: number) {
  const rawTargetName = finding.target == null
    ? ''
    : offerQuestionTargetLabel(finding.target);
  const targetName = rawTargetName === 'Podstawa do sprawdzenia' ? '' : publicOfferText(rawTargetName).trim();
  const text = publicOfferText(finding.question, '').trim()
    || publicOfferText(finding.finding, '').trim();
  const conciseTarget = targetName.length > 64 ? `${targetName.slice(0, 61).trimEnd()}…` : targetName;
  const conciseText = text.length > 100 ? `${text.slice(0, 97).trimEnd()}…` : text;
  if (conciseTarget && conciseText) return `${conciseTarget} — ${conciseText}`;
  if (conciseTarget) return conciseTarget;
  if (conciseText) return conciseText;
  return `Sprawa ${index + 1}`;
}

export function createSelectedOfferQuestionMail(
  supplierName: string,
  selectedFindings: Array<{ finding: OfferQuestionsFinding; key: string }>,
): PreparedOfferQuestionMail {
  const safeSupplierName = publicOfferText(supplierName, '').replace(/\s+/gu, ' ').trim() || 'dostawcy';
  const subject = `Pytania dotyczące oferty — ${safeSupplierName}`.slice(0, 200);
  const questions = selectedFindings.map(({ finding }) => {
    const question = publicOfferText(finding.question, '').trim();
    const findingText = publicOfferText(finding.finding, '').trim();
    return question || (findingText
      ? `Prosimy o wyjaśnienie: ${findingText}`
      : 'Prosimy o doprecyzowanie tej sprawy.');
  });
  const body = [
    'Dzień dobry,',
    '',
    `prosimy o odpowiedź na poniższe pytania dotyczące oferty ${safeSupplierName}:`,
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Z góry dziękujemy.',
    'Pozdrawiamy,',
  ].join('\n');

  return {
    subject,
    body,
    findingKeys: selectedFindings.map(({ key }) => key),
  };
}