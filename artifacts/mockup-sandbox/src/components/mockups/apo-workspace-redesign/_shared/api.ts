export type ApoChatAttachment = {
  documentId: string;
  filename: string;
  versionId?: string | null;
  offerDocumentId?: string | null;
};

export type ApoMailSource = string | {
  filename?: string | null;
  label?: string | null;
  source?: string | null;
  documentId?: string | null;
  mailText?: string | null;
  text?: string | null;
  content?: string | null;
  body?: string | null;
};

export type SogoDocument = {
  documentId: string;
  filename: string;
  size: number;
  status: string;
};